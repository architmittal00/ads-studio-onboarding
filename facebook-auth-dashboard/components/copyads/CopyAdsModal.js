import { useEffect, useState } from "react";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import Thumb from "@/components/Thumb";
import CreativeLightbox from "@/components/CreativeLightbox";
import CopyIdButton from "@/components/CopyIdButton";
import CampaignFields from "@/components/CampaignFields";
import AdSetFields from "@/components/AdSetFields";
import { CloseIcon, ChevronIcon, DatabaseIcon, ListIcon, CopyIcon, CheckIcon, PauseIcon, PlayIcon } from "@/components/icons";
import { parseJsonResponse, fetchWithTimeout, responseError } from "@/lib/fetchJson";
import styles from "@/styles/Home.module.css";
import { track } from "@/lib/analytics";

// Per-ad live-progress phase → badge styling/label, for the table shown
// while `submitting` below. Added once pages/api/fb/copy-ads/copy.js started
// copying up to 5 ads concurrently (COPY_CONCURRENCY) — the single rolling
// progress message it streams stopped being a meaningful "what's happening"
// indicator (several ads' own messages interleave out of order), so each
// ad's own `ad_start`/`ad_done` events drive its own row instead.
const PHASE_BADGE_CLASS = {
  queued: styles.badgeInfo,
  copying: styles.badgeInfo,
  success: styles.badgeGood,
  skipped: styles.badgeWarn,
  failed: styles.badgeDanger,
};
const PHASE_LABEL = {
  queued: "Queued",
  copying: "Copying…",
  success: "Done",
  skipped: "Skipped",
  failed: "Failed",
};

// Which icon heads each step's title — purely decorative, gives each step
// its own visual identity instead of every screen in this modal looking
// identical aside from its heading text.
const STEP_ICON = {
  loading_source: DatabaseIcon,
  pick_destination: DatabaseIcon,
  choose_campaign_mode: DatabaseIcon,
  pick_campaign: ListIcon,
  pick_adset: ListIcon,
  review: CopyIcon,
  done: CheckIcon,
  error: DatabaseIcon,
};

// Small gradient icon badge — same background (`var(--grad)`, the app's own
// primary-action gradient) and 36px/10px-radius shape as the sidebar's own
// `.logoMark`, just reusable with any icon instead of the hardcoded "f".
function StepIcon({ icon: Icon }) {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 10,
        background: "var(--grad)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#fff",
      }}
    >
      <Icon size={17} />
    </div>
  );
}

// Labeled section wrapper for the "review" step — gives each part of the
// form (ads being renamed, status after copying, live progress) its own
// bordered card with an icon+heading instead of everything running
// together as one flat, undifferentiated block.
function Section({ icon: Icon, title, children }) {
  return (
    <div className={styles.card} style={{ padding: 14, marginBottom: 14 }}>
      <p style={{ display: "flex", alignItems: "center", gap: 7, fontWeight: 700, fontSize: 12.5, marginBottom: 10, color: "var(--t1)" }}>
        <span style={{ color: "var(--purple)", display: "inline-flex" }}>
          <Icon size={13} />
        </span>
        {title}
      </p>
      {children}
    </div>
  );
}

// Minimal searchable list for picking a destination ad set — same pattern
// as pages/launch.js's own PickerList and components/DuplicateEntityModal.js's
// cousin of it. Kept as its own small copy rather than a shared import,
// same reasoning those two files' own comments give: each caller wants
// slightly different row content.
function AdsetPickerList({ adsets, query, onQueryChange, selectedIds, onToggle }) {
  const filtered = query.trim() ? adsets.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase())) : adsets;
  return (
    <div>
      <input
        type="text"
        autoFocus
        className={styles.select}
        style={{ width: "100%", marginBottom: 10 }}
        placeholder="Search ad sets…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className={styles.sub}>No ad sets found in this account.</p>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
          {filtered.map((a) => (
            <div
              key={a.id}
              onClick={() => onToggle(a)}
              style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", background: selectedIds.has(a.id) ? "var(--card2)" : undefined }}
            >
              <input type="checkbox" checked={selectedIds.has(a.id)} readOnly style={{ flexShrink: 0, pointerEvents: "none" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                <span className={styles.muted}>{a.campaign?.name || "No campaign"}</span>
              </div>
              <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                {a.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Same pattern as AdsetPickerList above, for the Ad Set level's "attach to
// an existing campaign" destination option.
function CampaignPickerList({ campaigns, query, onQueryChange, onPick }) {
  const filtered = query.trim() ? campaigns.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase())) : campaigns;
  return (
    <div>
      <input
        type="text"
        autoFocus
        className={styles.select}
        style={{ width: "100%", marginBottom: 10 }}
        placeholder="Search campaigns…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p className={styles.sub}>No campaigns found in this account.</p>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", maxHeight: 280, overflowY: "auto" }}>
          {filtered.map((c) => (
            <div
              key={c.id}
              onClick={() => onPick(c)}
              style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
              <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                {c.effective_status}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackLink({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--t2)", fontSize: 12.5, padding: 0, marginBottom: 12 }}
    >
      <ChevronIcon direction="left" size={12} />
      Back
    </button>
  );
}

function StepRow({ step }) {
  // A succeeded step can still carry a non-blocking `warning` (e.g. copied
  // without an Instagram actor) — shown with the amber skipped-style icon
  // so it's visibly distinct from a clean success, without being counted
  // as a failure anywhere (createdAdIds/overallSuccess already don't).
  const icon = step.warning ? "⚠" : step.success ? "✓" : step.skipped ? "⊘" : "✗";
  const color = step.warning ? "var(--amber)" : step.success ? "var(--green)" : step.skipped ? "var(--amber)" : "var(--red)";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "2px 0" }}>
      <span style={{ color, fontWeight: 700, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, color: "var(--t2)" }}>
        {step.label}
        {step.error && <span> · {step.error}</span>}
        {step.warning && <span> · {step.warning}</span>}
      </span>
      {/* Only a step that actually created something carries a useful id to
          copy — the new object's own id, so the user can jump straight to it
          in Ads Manager. */}
      {(step.type === "ad" || step.type === "adset" || step.type === "campaign") && step.success && step.id && <CopyIdButton id={step.id} />}
    </div>
  );
}

// One ad's worth of result — the server returns a flat, interleaved
// `steps` array ("Creative — X", "Ad — X", "Creative — Y", "Ad — Y", …) with
// no visual grouping, which is exactly what made it unclear which lines
// belonged to which source ad once more than one was copied (reported by
// the user against the live deployed page). Every per-ad step carries the
// same `adId` it was copied from, so steps are grouped by that here and
// rendered as one card per source ad instead — thumbnail + "copied from"
// name up top (the name the user actually recognizes), its own status
// badge, and the Creative/Ad sub-steps nested underneath.
function adGroupStatus(steps) {
  if (steps.some((s) => !s.success && !s.skipped)) return "failed";
  if (steps.some((s) => s.skipped)) return "skipped";
  if (steps.some((s) => s.warning)) return "warning";
  return "success";
}
const AD_GROUP_BADGE = {
  success: { className: "badgeGood", label: "Copied" },
  warning: { className: "badgeWarn", label: "Copied with a note" },
  skipped: { className: "badgeWarn", label: "Skipped" },
  failed: { className: "badgeDanger", label: "Failed" },
};

function CopiedAdGroup({ steps, sourceAd, newName, onPreview }) {
  const status = adGroupStatus(steps);
  const badge = AD_GROUP_BADGE[status];
  return (
    <div style={{ borderRadius: 10, background: "var(--bg)", padding: "8px 10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Thumb src={sourceAd?.thumbnailUrl} isVideo={sourceAd?.isVideo} size={32} onClick={sourceAd ? onPreview : undefined} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {status === "failed" || status === "skipped" ? steps[0].name : newName || steps[0].name}
          </p>
          <p className={styles.muted} style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Copied from &quot;{steps[0].name}&quot;
          </p>
        </div>
        <span className={styles[badge.className]} style={{ flexShrink: 0 }}>
          {badge.label}
        </span>
      </div>
      <div style={{ marginTop: 6, paddingLeft: 42, display: "flex", flexDirection: "column" }}>
        {steps.map((s, i) => (
          <StepRow key={i} step={s} />
        ))}
      </div>
    </div>
  );
}

// Reads one of the new ad-set/campaign-level streaming endpoints' NDJSON
// response — same convention as pages/copy-ads.js's own fetchSourceAdsStream,
// just a small local copy since this file already has its own small helpers
// for similar reasons (see AdsetPickerList's comment).
async function readNdjson(res, onEvent) {
  if (!res.ok || !res.body) {
    throw await responseError(res);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line));
    }
  }
}

function newCampaignBudgetFromSource(sourceFields) {
  return {
    budgetStrategy: sourceFields?.budgetStrategy || "ABO",
    budgetType: sourceFields?.budgetType || "DAILY",
    budgetAmount: sourceFields?.budgetAmount || "",
  };
}

// Checklist of ads to copy — the Ad Set/Campaign levels' own version of
// pages/copy-ads.js's ad-level picker table, scoped to one ad set's worth of
// ads instead of a whole account. Every copyable ad starts checked; a
// non-copyable one is shown disabled with its reason, same treatment as the
// ad-level picker.
const STREAM_CUT_MESSAGE =
  "The copy stopped before it finished (the connection closed or timed out). Anything already created is in Ads Manager, paused — check there before retrying.";

// Every copy route ends its stream with one "done" event. If the connection
// drops first (timeout, network), or the event carries only an `error`, the
// screens below would read missing arrays and crash. Always hand them a full shape.
function normalizeCopyResult(r) {
  return {
    ...(r || {}),
    success: !!r?.success && !r?.error,
    createdAdIds: r?.createdAdIds || [],
    createdAdsetIds: r?.createdAdsetIds || [],
    steps: r?.steps || [],
    error: r?.error || (r ? null : STREAM_CUT_MESSAGE),
  };
}

function AdChecklist({ ads, selectedIds, onToggle, onPreview }) {
  if (ads.length === 0) return <p className={styles.sub}>No ads in this ad set.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto" }}>
      {ads.map((ad) => (
        <div key={ad.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, background: "var(--bg)" }}>
          <input type="checkbox" checked={selectedIds.has(ad.id)} disabled={!ad.copyable} onChange={() => onToggle(ad.id, ad.copyable)} title={ad.copyable ? undefined : ad.reason} />
          <Thumb src={ad.thumbnailUrl} isVideo={ad.isVideo} size={28} onClick={() => onPreview(ad)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 600, color: ad.copyable ? undefined : "var(--t2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ad.name}</p>
            {!ad.copyable && (
              <span className={styles.badgeWarn} style={{ fontSize: 10 }}>
                {ad.reason}
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Destination picker + review + confirm + live-progress result. Three
// levels, one modal — the step-state-machine shape and NDJSON progress
// consumption below is shared across all of them (modeled on components/
// DuplicateEntityModal.js and pages/api/fb/partnership/launch.js's own
// client-side reader loop, same as before this file supported more than
// ad-level copying):
//
// - "ad" (original, real-account-tested): clone a batch of ads' creative
//   into an ad set that already exists in a different account. Untouched by
//   the two levels below — same state, same steps, same endpoint
//   (pages/api/fb/copy-ads/copy.js).
// - "adset": clone one whole ad set — its own targeting/budget/pixel
//   settings, via lib/campaignLaunch.js's buildGenericAdsetPayload — into a
//   brand-new campaign cloned from its parent (or an existing destination
//   campaign), then copy every one of its ads the same way the "ad" level
//   already does. Endpoint: pages/api/fb/copy-ads/copy-adset.js.
// - "campaign": clone a whole campaign — a brand-new campaign, every one of
//   its ad sets recreated under it, every ad copied into each. No live
//   per-ad-set field editing in this first version (see the feature's own
//   plan) — each ad set clones its source settings as-is; only which ad
//   sets/ads to include is adjustable. Endpoint:
//   pages/api/fb/copy-ads/copy-campaign.js.
export default function CopyAdsModal({
  level = "ad",
  sourceAccountId,
  ads: adsProp,
  sourceAdsets,
  sourceCampaigns,
  adAccounts,
  onClose,
  onDone,
}) {
  // Captured once at mount, not read live off the prop for the rest of this
  // component's life — onDone (below) tells the parent page to clear its
  // selection the moment a copy succeeds, which would otherwise shrink
  // `adsProp` out from under the still-open result screen mid-render (the
  // exact "N of 0" stale-count bug class already hit once this session in
  // components/partnership/BulkPermissionModal.js, fixed there the same way).
  const [ads] = useState(adsProp || []);
  // Same one-time-capture reasoning for the Ad Set/Campaign levels' own
  // arrays — pages/copy-ads.js clears its selection the moment a batch
  // succeeds (onDone below), which must not shrink these mid-render either.
  const [sourceAdsetList] = useState(sourceAdsets || []);
  const [sourceCampaignList] = useState(sourceCampaigns || []);
  // Ad Set level: 2+ selected source ad sets can only ever land together in
  // one EXISTING destination campaign (the user's own resolution of this
  // feature's one deferred question — see pages/copy-ads.js's own comment
  // and copy-adset.js's matching validation) — a completely different review
  // UI from the single-ad-set flow below, which keeps its original
  // fully-editable CampaignFields/AdSetFields form untouched.
  const isMultiAdset = level === "adset" && sourceAdsetList.length > 1;
  const singleSourceAdsetId = level === "adset" ? sourceAdsetList[0]?.id : null;
  // Campaign level: several selected source campaigns are processed as a
  // queue, one at a time — copy-campaign.js's own contract was deliberately
  // kept single-campaign-per-request (to keep that endpoint's scope small),
  // so this component loops over sourceCampaignList itself, reusing the
  // exact same single-campaign loading/review/submit flow for whichever
  // campaign is current, and aggregates every campaign's own result into
  // campaignResults for one combined "done" screen at the end.
  const [campaignQueueIndex, setCampaignQueueIndex] = useState(0);
  const [campaignResults, setCampaignResults] = useState([]); // [{sourceCampaignId, sourceCampaignName, result, adSourceById, names}]
  const currentSourceCampaign = level === "campaign" ? sourceCampaignList[campaignQueueIndex] : null;
  const isMultiCampaign = level === "campaign" && sourceCampaignList.length > 1;
  const [step, setStep] = useState(level === "ad" ? "pick_destination" : "loading_source");
  const [loadError, setLoadError] = useState(null);
  const [destAccountId, setDestAccountId] = useState("");
  const [adsetsLoading, setAdsetsLoading] = useState(false);
  const [adsetsError, setAdsetsError] = useState(null);
  const [adsets, setAdsets] = useState([]);
  // Ad level: one or several destination ad sets (full objects, kept for their names).
  const [destAdsets, setDestAdsets] = useState([]);
  const [adsetQuery, setAdsetQuery] = useState("");

  const [names, setNames] = useState(() => Object.fromEntries(ads.map((a) => [a.id, `${a.name} - Copy`])));
  const [status, setStatus] = useState("PAUSED");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);
  const [lightboxItem, setLightboxItem] = useState(null);
  // Per-ad live status, keyed by source ad id: { phase: "queued"|"copying"|
  // "success"|"skipped"|"failed", error?, warning?, newAdId? }. Seeded to
  // "queued" for every selected ad the moment the copy starts (below), so
  // every row renders immediately rather than waiting for the first server
  // event.
  const [adProgress, setAdProgress] = useState({});
  // Shared by the Ad Set/Campaign levels for their own new object creation
  // steps — keyed by a synthetic id ("campaign", or an ad set's sourceAdsetId)
  // -> { phase, name, id?, error? }.
  const [objectProgress, setObjectProgress] = useState({});

  // ── Ad Set level only ──
  const [adsetSourceFields, setAdsetSourceFields] = useState(null); // toFormFields() shape, pre-filled AdSetFields value
  const [adsetSourceCampaignFields, setAdsetSourceCampaignFields] = useState(null); // {fields, budgetStrategy, budgetType, budgetAmount, specialAdCategories}
  const [destinationMode, setDestinationMode] = useState("existing_campaign"); // "new_campaign" | "existing_campaign"
  const [destCampaignsLoading, setDestCampaignsLoading] = useState(false);
  const [destCampaignsError, setDestCampaignsError] = useState(null);
  const [destCampaigns, setDestCampaigns] = useState([]);
  const [destCampaign, setDestCampaign] = useState(null); // existing destination campaign object, when destinationMode is "existing_campaign"
  const [campaignQuery, setCampaignQuery] = useState("");
  const [newCampaignFields, setNewCampaignFields] = useState(null); // CampaignFields value
  const [newAdsetFields, setNewAdsetFields] = useState(null); // AdSetFields value
  const [campaignBudget, setCampaignBudget] = useState({ budgetStrategy: "ABO", budgetType: "DAILY", budgetAmount: "" });
  const [destPixels, setDestPixels] = useState([]);
  const [sourceAdItems, setSourceAdItems] = useState([]); // adset-ads.js's cross-account-ready ad list for sourceAdsetId
  const [sourceAdItemsLoading, setSourceAdItemsLoading] = useState(false);
  const [selectedSourceAdIds, setSelectedSourceAdIds] = useState(new Set());

  // ── Ad Set level, multi-select only (isMultiAdset) ──
  // One entry per selected source ad set, same shape as the Campaign level's
  // own campaignAdsets below (kept as a separate copy rather than shared
  // state — the two flows differ enough, see this file's header comment on
  // AdsetPickerList/CampaignPickerList for the same "separate small copies"
  // reasoning — and minimizing changes near the already real-account-tested
  // campaign-level code avoids risking a regression there for an unrelated
  // feature): { name, fields (toFormFields shape), ads, loading, error,
  // included, selectedAdIds }.
  const [adsetEntries, setAdsetEntries] = useState({});
  const [adsetEntryOrder, setAdsetEntryOrder] = useState([]);

  // ── Campaign level only ──
  // Per source ad set under sourceCampaignId: { name, status, fields
  // (AdSetFields-shape, from toFormFields), ads (adset-ads.js list), loading,
  // error, included (boolean), selectedAdIds (Set) }.
  const [campaignAdsets, setCampaignAdsets] = useState({});
  const [campaignAdsetOrder, setCampaignAdsetOrder] = useState([]); // stable render order

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [submitting, onClose]);

  // One-time load of the source object(s) this modal was opened for — the
  // "ad" level needs nothing here (the selected ads already carry everything
  // this modal needs), but "adset"/"campaign" need to fetch the real,
  // current settings of what's being cloned before the destination/review
  // steps have anything to show.
  useEffect(() => {
    if (level === "adset" && isMultiAdset) {
      const order = sourceAdsetList.map((a) => a.id);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed of each selected ad set's loading placeholder, not derivable from props/state
      setAdsetEntryOrder(order);
      setAdsetEntries(
        Object.fromEntries(
          order.map((id) => [
            id,
            { name: sourceAdsetList.find((a) => a.id === id)?.name, fields: null, ads: [], loading: true, error: null, included: true, selectedAdIds: new Set() },
          ])
        )
      );
      // Each ad set's own full detail (for toFormFields) + its own copyable
      // ad list — fetched in parallel, not blocking the destination-account
      // step from being shown. Same pair of calls the Campaign level's own
      // loading branch below makes per ad set.
      order.forEach((adsetId) => {
        Promise.all([
          fetchWithTimeout(`/api/fb/adsets-list?adsetId=${encodeURIComponent(adsetId)}`).then(parseJsonResponse),
          fetchWithTimeout(`/api/fb/copy-ads/adset-ads?adsetId=${encodeURIComponent(adsetId)}`),
        ])
          .then(async ([adsetJson, adsRes]) => {
            if (adsetJson.error) throw new Error(adsetJson.error);
            const items = [];
            await readNdjson(adsRes, (event) => {
              if (event.type === "ads_batch") items.push(...event.ads);
            });
            setAdsetEntries((prev) => ({
              ...prev,
              [adsetId]: { ...prev[adsetId], fields: adsetJson.fields, ads: items, selectedAdIds: new Set(items.filter((a) => a.copyable).map((a) => a.id)), loading: false },
            }));
            setNames((prev) => ({ ...prev, ...Object.fromEntries(items.map((a) => [a.id, `${a.name} - Copy`])) }));
          })
          .catch((err) => {
            setAdsetEntries((prev) => ({ ...prev, [adsetId]: { ...prev[adsetId], loading: false, error: err.message, included: false } }));
          });
      });
      setStep("pick_destination");
      return;
    }
    if (level === "adset") {
      Promise.all([
        fetchWithTimeout(`/api/fb/adsets-list?adsetId=${encodeURIComponent(singleSourceAdsetId)}`).then(parseJsonResponse),
        fetchWithTimeout(`/api/fb/copy-ads/adset-ads?adsetId=${encodeURIComponent(singleSourceAdsetId)}`),
      ])
        .then(async ([adsetJson, adsRes]) => {
          if (adsetJson.error) {
            setLoadError(adsetJson.error);
            setStep("error");
            return;
          }
          setAdsetSourceFields(adsetJson.fields);
          setNewAdsetFields(adsetJson.fields);
          setAdsetSourceCampaignFields(adsetJson.campaignFields);
          setNewCampaignFields(adsetJson.campaignFields?.fields || null);
          // Strategy (CBO/ABO) and type come from the source CAMPAIGN's own
          // shape (it decides where a budget lives at all); the AMOUNT under
          // ABO has to come from the source AD SET's own budget instead —
          // an ABO campaign has no budget of its own by definition, so
          // newCampaignBudgetFromSource(campaignFields) alone would always
          // derive an empty amount for exactly the case (ABO) where an
          // amount is actually needed.
          const derivedBudget = newCampaignBudgetFromSource(adsetJson.campaignFields);
          setCampaignBudget(derivedBudget.budgetStrategy === "ABO" ? { ...derivedBudget, budgetAmount: adsetJson.fields.budgetAmount || "" } : derivedBudget);

          const items = [];
          await readNdjson(adsRes, (event) => {
            if (event.type === "ads_batch") items.push(...event.ads);
          });
          setSourceAdItems(items);
          setSelectedSourceAdIds(new Set(items.filter((a) => a.copyable).map((a) => a.id)));
          setNames(Object.fromEntries(items.map((a) => [a.id, `${a.name} - Copy`])));
          setStep("pick_destination");
        })
        .catch((err) => {
          setLoadError(err.message);
          setStep("error");
        });
    } else if (level === "campaign") {
      const campaignId = currentSourceCampaign?.id;
      if (!campaignId) return;
      Promise.all([
        fetchWithTimeout(`/api/fb/campaigns-list?campaignId=${encodeURIComponent(campaignId)}`).then(parseJsonResponse),
        fetchWithTimeout(`/api/fb/adsets-list?campaignId=${encodeURIComponent(campaignId)}`).then(parseJsonResponse),
      ])
        .then(([campJson, adsetsJson]) => {
          if (campJson.error) {
            setLoadError(campJson.error);
            setStep("error");
            return;
          }
          if (adsetsJson.error) {
            setLoadError(adsetsJson.error);
            setStep("error");
            return;
          }
          setNewCampaignFields(campJson.fields.fields);
          setCampaignBudget(newCampaignBudgetFromSource(campJson.fields));

          const order = (adsetsJson.adsets || []).map((a) => a.id);
          setCampaignAdsetOrder(order);
          setCampaignAdsets(
            Object.fromEntries(
              (adsetsJson.adsets || []).map((a) => [a.id, { name: a.name, status: a.status, fields: null, ads: [], loading: true, error: null, included: true, selectedAdIds: new Set() }])
            )
          );
          // Each ad set's own full detail (for toFormFields, matching
          // properties) + its own copyable ad list — fetched in parallel,
          // not blocking the destination-account step from being shown.
          order.forEach((adsetId) => {
            Promise.all([
              fetchWithTimeout(`/api/fb/adsets-list?adsetId=${encodeURIComponent(adsetId)}`).then(parseJsonResponse),
              fetchWithTimeout(`/api/fb/copy-ads/adset-ads?adsetId=${encodeURIComponent(adsetId)}`),
            ])
              .then(async ([adsetJson, adsRes]) => {
                if (adsetJson.error) throw new Error(adsetJson.error);
                const items = [];
                await readNdjson(adsRes, (event) => {
                  if (event.type === "ads_batch") items.push(...event.ads);
                });
                setCampaignAdsets((prev) => ({
                  ...prev,
                  [adsetId]: {
                    ...prev[adsetId],
                    fields: adsetJson.fields,
                    ads: items,
                    selectedAdIds: new Set(items.filter((a) => a.copyable).map((a) => a.id)),
                    loading: false,
                  },
                }));
              })
              .catch((err) => {
                setCampaignAdsets((prev) => ({ ...prev, [adsetId]: { ...prev[adsetId], loading: false, error: err.message, included: false } }));
              });
          });
          // The destination account is picked once for the whole queue (on
          // the FIRST campaign) and reused for every campaign after it — see
          // handleConfirmCampaign's queue-advance — so once it's already set,
          // skip straight back to "review" instead of asking again.
          setStep(destAccountId ? "review" : "pick_destination");
        })
        .catch((err) => {
          setLoadError(err.message);
          setStep("error");
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs only when the campaign queue advances (level "campaign") or once on mount otherwise, keyed to the specific object(s) this modal was opened for
  }, [campaignQueueIndex]);

  // A destination campaign that already carries its own daily/lifetime
  // budget is CBO (ad sets under it can't also have one); one with neither
  // is ABO, so the new ad set needs its own budget amount — mirrors
  // pages/launch.js's own campaignHasOwnBudget exactly, just derived from
  // whichever existing campaign is currently picked here instead of a form
  // field, and from the source's own shape when creating a new campaign.
  useEffect(() => {
    if (level !== "adset" || destinationMode !== "existing_campaign" || !destCampaign) return;
    const hasOwnBudget = !!(destCampaign.daily_budget || destCampaign.lifetime_budget);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to the destination campaign choice changing, same "derive budget shape from whatever's now selected" pattern pages/launch.js already uses
    setCampaignBudget({
      budgetStrategy: hasOwnBudget ? "CBO" : "ABO",
      budgetType: destCampaign.lifetime_budget ? "LIFETIME" : "DAILY",
      // Under ABO here, the amount is still the SOURCE ad set's own budget
      // (what's actually being cloned) — the existing destination campaign
      // having no budget of its own just tells us ABO applies, not what the
      // amount should be.
      budgetAmount: hasOwnBudget ? (destCampaign.daily_budget ? String(destCampaign.daily_budget / 100) : String(destCampaign.lifetime_budget / 100)) : adsetSourceFields?.budgetAmount || "",
    });
  }, [level, destinationMode, destCampaign, adsetSourceFields]);

  const destinationAccounts = adAccounts.filter((a) => a.id !== sourceAccountId);

  function loadAdsets(accountId) {
    setAdsetsLoading(true);
    setAdsetsError(null);
    fetchWithTimeout(`/api/fb/adsets-list?accountId=${encodeURIComponent(accountId)}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) setAdsetsError(json.error);
        else setAdsets(json.adsets || []);
      })
      .catch((err) => setAdsetsError(err.message))
      .finally(() => setAdsetsLoading(false));
  }

  function loadDestPixels(accountId) {
    fetchWithTimeout(`/api/fb/targeting-data?accountId=${encodeURIComponent(accountId)}`)
      .then(parseJsonResponse)
      .then((json) => setDestPixels(json.pixels || []))
      .catch(() => setDestPixels([]));
  }

  function loadDestCampaigns(accountId) {
    setDestCampaignsLoading(true);
    setDestCampaignsError(null);
    fetchWithTimeout(`/api/fb/campaigns-list?accountId=${encodeURIComponent(accountId)}`)
      .then(parseJsonResponse)
      .then((json) => {
        if (json.error) setDestCampaignsError(json.error);
        else setDestCampaigns(json.campaigns || []);
      })
      .catch((err) => setDestCampaignsError(err.message))
      .finally(() => setDestCampaignsLoading(false));
  }

  function pickDestAccount(id) {
    setDestAccountId(id);
    if (level === "ad") {
      setDestAdsets([]);
      setAdsetQuery("");
      loadAdsets(id);
      setStep("pick_adset");
    } else if (level === "adset") {
      setDestCampaign(null);
      loadDestPixels(id);
      if (isMultiAdset) {
        // Multi-select forces existing_campaign (see this file's header
        // comment) — skip straight to picking that campaign, no "new
        // campaign" choice to offer.
        setCampaignQuery("");
        loadDestCampaigns(id);
        setStep("pick_campaign");
      } else {
        setStep("choose_campaign_mode");
      }
    } else {
      loadDestPixels(id);
      setStep("review");
    }
  }

  function toggleDestAdset(adset) {
    setDestAdsets((prev) => (prev.some((a) => a.id === adset.id) ? prev.filter((a) => a.id !== adset.id) : [...prev, adset]));
  }

  function pickDestCampaign(campaign) {
    setDestCampaign(campaign);
    setStep("review");
  }

  function toggleSourceAd(adId, copyable) {
    if (!copyable) return;
    setSelectedSourceAdIds((prev) => {
      const next = new Set(prev);
      if (next.has(adId)) next.delete(adId);
      else next.add(adId);
      return next;
    });
  }

  function toggleCampaignAdsetAd(adsetId, adId, copyable) {
    if (!copyable) return;
    setCampaignAdsets((prev) => {
      const entry = prev[adsetId];
      const next = new Set(entry.selectedAdIds);
      if (next.has(adId)) next.delete(adId);
      else next.add(adId);
      return { ...prev, [adsetId]: { ...entry, selectedAdIds: next } };
    });
  }

  function toggleCampaignAdsetIncluded(adsetId) {
    setCampaignAdsets((prev) => ({ ...prev, [adsetId]: { ...prev[adsetId], included: !prev[adsetId].included } }));
  }

  // Under ABO, this campaign's new ad sets each carry their OWN budget
  // (cloned from the source ad set's own daily/lifetime amount via
  // adsets-list.js's toFormFields) — there's no campaign-level amount to
  // confirm instead. Previously that per-ad-set amount was silently carried
  // through with no way to see or adjust it before copying; this lets each
  // card's own budget be confirmed/edited, same as the single-ad-set flow's
  // own ABO budget input already does for its one ad set.
  function updateCampaignAdsetBudget(adsetId, budgetAmount) {
    setCampaignAdsets((prev) => ({ ...prev, [adsetId]: { ...prev[adsetId], fields: { ...prev[adsetId].fields, budgetAmount } } }));
  }

  // Same pair of handlers as toggleCampaignAdsetAd/Included above, for the
  // Ad Set level's own multi-select entries (adsetEntries).
  function toggleAdsetEntryAd(adsetId, adId, copyable) {
    if (!copyable) return;
    setAdsetEntries((prev) => {
      const entry = prev[adsetId];
      const next = new Set(entry.selectedAdIds);
      if (next.has(adId)) next.delete(adId);
      else next.add(adId);
      return { ...prev, [adsetId]: { ...entry, selectedAdIds: next } };
    });
  }

  function toggleAdsetEntryIncluded(adsetId) {
    setAdsetEntries((prev) => ({ ...prev, [adsetId]: { ...prev[adsetId], included: !prev[adsetId].included } }));
  }

  // Same reasoning as updateCampaignAdsetBudget above, for the Ad Set
  // level's own multi-select entries — ABO under an existing destination
  // campaign means each of these ad sets keeps its own budget too.
  function updateAdsetEntryBudget(adsetId, budgetAmount) {
    setAdsetEntries((prev) => ({ ...prev, [adsetId]: { ...prev[adsetId], fields: { ...prev[adsetId].fields, budgetAmount } } }));
  }

  async function handleConfirmAd() {
    setSubmitting(true);
    setSubmitError(null);
    setAdProgress(Object.fromEntries(ads.map((a) => [a.id, { phase: "queued" }])));
    try {
      track("copy_ads_started", { level: "ad" });
      const res = await fetch("/api/fb/copy-ads/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAccountId,
          destAccountId,
          destAdsetIds: destAdsets.map((a) => a.id),
          items: ads.map((a) => ({ adId: a.id, name: names[a.id] })),
          finalStatus: status,
        }),
      });
      let finalResult = null;
      // With several destination ad sets each ad is copied once per ad set; its row
      // shows "copying" until every ad set is done, then success only if all worked.
      const totalDests = destAdsets.length;
      const doneByAd = {};
      await readNdjson(res, (event) => {
        if (event.type === "ad_start") {
          setAdProgress((prev) => ({ ...prev, [event.adId]: { ...prev[event.adId], phase: "copying" } }));
        } else if (event.type === "ad_done") {
          const agg = (doneByAd[event.adId] ||= { done: 0, failed: 0, skipped: 0, error: null, newAdId: null, warning: null });
          agg.done += 1;
          if (event.success) agg.newAdId = agg.newAdId || event.newAdId;
          else if (event.skipped) agg.skipped += 1;
          else agg.failed += 1;
          if (!event.success && !agg.error) agg.error = event.error;
          if (event.warning && !agg.warning) agg.warning = event.warning;
          const finished = agg.done >= totalDests;
          setAdProgress((prev) => ({
            ...prev,
            [event.adId]: {
              phase: !finished ? "copying" : agg.failed > 0 ? "failed" : agg.skipped > 0 ? "skipped" : "success",
              error: agg.error,
              warning: agg.warning,
              newAdId: agg.newAdId,
            },
          }));
        } else if (event.type === "done") {
          finalResult = event;
        }
      });
      finalResult = normalizeCopyResult(finalResult);
      setResult(finalResult);
      setStep("done");
      onDone?.(finalResult);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Builds copy-adset.js's own `adsets` array contract — one entry when
  // this is the original single-ad-set flow (its own fully-editable
  // CampaignFields/AdSetFields state), several when isMultiAdset (one entry
  // per included adsetEntries row).
  function buildAdsetsPayload() {
    if (!isMultiAdset) {
      const items = sourceAdItems.filter((a) => selectedSourceAdIds.has(a.id)).map((a) => ({ adId: a.id, name: names[a.id] }));
      return [{ sourceAdsetId: singleSourceAdsetId, adsetFields: newAdsetFields, items }];
    }
    return adsetEntryOrder
      .filter((id) => adsetEntries[id]?.included)
      .map((id) => ({
        sourceAdsetId: id,
        adsetFields: adsetEntries[id].fields,
        items: adsetEntries[id].ads.filter((a) => adsetEntries[id].selectedAdIds.has(a.id)).map((a) => ({ adId: a.id, name: names[a.id] || `${a.name} - Copy` })),
      }));
  }

  async function handleConfirmAdset() {
    setSubmitting(true);
    setSubmitError(null);
    const adsetsPayload = buildAdsetsPayload();
    const initialAdProgress = {};
    const initialObjectProgress = destinationMode === "new_campaign" ? { campaign: { phase: "queued", name: newCampaignFields?.name } } : {};
    for (const entry of adsetsPayload) {
      initialObjectProgress[entry.sourceAdsetId] = { phase: "queued", name: entry.adsetFields?.name };
      for (const item of entry.items) initialAdProgress[item.adId] = { phase: "queued" };
    }
    setAdProgress(initialAdProgress);
    setObjectProgress(initialObjectProgress);
    try {
      track("copy_ads_started", { level: "adset" });
      const res = await fetch("/api/fb/copy-ads/copy-adset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAccountId,
          destAccountId,
          adsets: adsetsPayload,
          destinationMode,
          destCampaignId: destinationMode === "existing_campaign" ? destCampaign?.id : undefined,
          campaignFields: destinationMode === "new_campaign" ? newCampaignFields : undefined,
          campaignBudget,
          finalStatus: status,
        }),
      });
      let finalResult = null;
      await readNdjson(res, (event) => {
        if (event.type === "campaign_start") setObjectProgress((prev) => ({ ...prev, campaign: { phase: "working", name: event.name } }));
        else if (event.type === "campaign_done")
          setObjectProgress((prev) => ({ ...prev, campaign: { phase: event.success ? "success" : "failed", name: prev.campaign?.name, id: event.id, error: event.error } }));
        else if (event.type === "adset_start") setObjectProgress((prev) => ({ ...prev, [event.sourceAdsetId]: { ...prev[event.sourceAdsetId], phase: "working", name: event.name } }));
        else if (event.type === "adset_done")
          setObjectProgress((prev) => ({ ...prev, [event.sourceAdsetId]: { phase: event.success ? "success" : "failed", name: prev[event.sourceAdsetId]?.name, id: event.id, error: event.error } }));
        else if (event.type === "ad_start") setAdProgress((prev) => ({ ...prev, [event.adId]: { ...prev[event.adId], phase: "copying" } }));
        else if (event.type === "ad_done")
          setAdProgress((prev) => ({ ...prev, [event.adId]: { phase: event.success ? "success" : event.skipped ? "skipped" : "failed", error: event.error, warning: event.warning, newAdId: event.newAdId } }));
        else if (event.type === "done") finalResult = event;
      });
      finalResult = normalizeCopyResult(finalResult);
      setResult(finalResult);
      setStep("done");
      onDone?.(finalResult);
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmCampaign() {
    setSubmitting(true);
    setSubmitError(null);
    const includedAdsetIds = campaignAdsetOrder.filter((id) => campaignAdsets[id]?.included);
    const initialAdProgress = {};
    const initialObjectProgress = { campaign: { phase: "queued", name: newCampaignFields?.name } };
    for (const adsetId of includedAdsetIds) {
      initialObjectProgress[adsetId] = { phase: "queued", name: campaignAdsets[adsetId].fields?.name || campaignAdsets[adsetId].name };
      for (const adId of campaignAdsets[adsetId].selectedAdIds) initialAdProgress[adId] = { phase: "queued" };
    }
    setAdProgress(initialAdProgress);
    setObjectProgress(initialObjectProgress);
    try {
      track("copy_ads_started", { level: "campaign" });
      const res = await fetch("/api/fb/copy-ads/copy-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceAccountId,
          destAccountId,
          sourceCampaignId: currentSourceCampaign.id,
          campaignFields: newCampaignFields,
          campaignBudget,
          adsets: includedAdsetIds.map((adsetId) => ({
            sourceAdsetId: adsetId,
            adsetFields: campaignAdsets[adsetId].fields,
            items: campaignAdsets[adsetId].ads.filter((a) => campaignAdsets[adsetId].selectedAdIds.has(a.id)).map((a) => ({ adId: a.id, name: names[a.id] || `${a.name} - Copy` })),
          })),
          finalStatus: status,
        }),
      });
      let finalResult = null;
      await readNdjson(res, (event) => {
        if (event.type === "campaign_start") setObjectProgress((prev) => ({ ...prev, campaign: { phase: "working", name: event.name } }));
        else if (event.type === "campaign_done")
          setObjectProgress((prev) => ({ ...prev, campaign: { phase: event.success ? "success" : "failed", name: prev.campaign?.name, id: event.id, error: event.error } }));
        else if (event.type === "adset_start") setObjectProgress((prev) => ({ ...prev, [event.sourceAdsetId]: { ...prev[event.sourceAdsetId], phase: "working", name: event.name } }));
        else if (event.type === "adset_done")
          setObjectProgress((prev) => ({ ...prev, [event.sourceAdsetId]: { phase: event.success ? "success" : "failed", name: prev[event.sourceAdsetId]?.name, id: event.id, error: event.error } }));
        else if (event.type === "ad_start") setAdProgress((prev) => ({ ...prev, [event.adId]: { ...prev[event.adId], phase: "copying" } }));
        else if (event.type === "ad_done")
          setAdProgress((prev) => ({ ...prev, [event.adId]: { phase: event.success ? "success" : event.skipped ? "skipped" : "failed", error: event.error, warning: event.warning, newAdId: event.newAdId, sourceAdsetId: event.sourceAdsetId } }));
        else if (event.type === "done") finalResult = event;
      });

      // Snapshot everything the "done" screen needs about THIS campaign
      // before resetting per-campaign state for the next one in the queue —
      // campaignAdsets/campaignAdsetOrder/names all get overwritten below
      // the moment we advance, so the done screen can't read them live the
      // way the single-campaign flow's own done rendering does.
      const completedEntry = {
        sourceCampaignId: currentSourceCampaign.id,
        sourceCampaignName: currentSourceCampaign.name,
        result: normalizeCopyResult(finalResult),
        adSourceById: new Map(campaignAdsetOrder.flatMap((id) => (campaignAdsets[id]?.ads || []).map((a) => [a.id, a]))),
        names: { ...names },
      };
      const updatedResults = [...campaignResults, completedEntry];
      setCampaignResults(updatedResults);

      if (campaignQueueIndex + 1 < sourceCampaignList.length) {
        setCampaignQueueIndex((i) => i + 1);
        setNewCampaignFields(null);
        setCampaignBudget({ budgetStrategy: "ABO", budgetType: "DAILY", budgetAmount: "" });
        setCampaignAdsets({});
        setCampaignAdsetOrder([]);
        setAdProgress({});
        setObjectProgress({});
        setStep("loading_source");
      } else {
        setStep("done");
        onDone?.({ success: updatedResults.every((r) => r.result?.success), results: updatedResults });
      }
    } catch (err) {
      setSubmitError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const destAccountName = destinationAccounts.find((a) => a.id === destAccountId)?.name || "";

  const campaignAdsetsLoaded = level === "campaign" && campaignAdsetOrder.length > 0 && campaignAdsetOrder.every((id) => !campaignAdsets[id]?.loading);
  const adsetEntriesLoaded = isMultiAdset && adsetEntryOrder.length > 0 && adsetEntryOrder.every((id) => !adsetEntries[id]?.loading);
  const canSubmitAdset = !submitting && (
    isMultiAdset
      ? !!destCampaign && adsetEntryOrder.some((id) => adsetEntries[id]?.included && adsetEntries[id]?.selectedAdIds?.size > 0)
      : newAdsetFields?.name && (destinationMode === "existing_campaign" ? !!destCampaign : !!newCampaignFields?.name) && selectedSourceAdIds.size > 0
  );
  const canSubmitCampaign = !submitting && newCampaignFields?.name && campaignAdsetOrder.some((id) => campaignAdsets[id]?.included && campaignAdsets[id]?.selectedAdIds?.size > 0);

  const headerTitle =
    step === "error"
      ? "Couldn't load this"
      : step === "pick_destination"
      ? "Choose a destination account"
      : step === "choose_campaign_mode"
      ? "Choose a destination"
      : step === "pick_campaign"
      ? "Choose a destination campaign"
      : step === "pick_adset"
      ? "Choose a destination ad set"
      : step === "review"
      ? "Review & copy"
      : step === "done"
      ? "Copy complete"
      : "Loading…";

  const headerSub =
    level === "ad"
      ? `${ads.length} ad${ads.length === 1 ? "" : "s"} selected`
      : level === "adset"
      ? isMultiAdset
        ? `${sourceAdsetList.length} ad sets selected`
        : `Ad set: ${sourceAdsetList[0]?.name || singleSourceAdsetId}`
      : isMultiCampaign
      ? `${sourceCampaignList.length} campaigns selected`
      : `Campaign: ${sourceCampaignList[0]?.name || sourceCampaignList[0]?.id}`;

  return (
    <>
      <div
        onClick={submitting ? undefined : onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.65)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 800, padding: 24 }}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className={styles.card}
          style={{ background: "var(--bg)", width: "min(680px, 100%)", maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column" }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <StepIcon icon={STEP_ICON[step] || DatabaseIcon} />
              <div>
                <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                  {headerTitle}
                </h2>
                <p className={styles.sub}>{headerSub}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={submitting} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
              <CloseIcon size={14} />
            </button>
          </div>

          {step === "loading_source" && (
            <div style={{ marginTop: 16 }}>
              <Loader
                label={
                  level === "adset"
                    ? isMultiAdset
                      ? "Loading ad sets…"
                      : "Loading ad set…"
                    : isMultiCampaign
                    ? `Loading campaign ${campaignQueueIndex + 1} of ${sourceCampaignList.length}…`
                    : "Loading campaign…"
                }
              />
            </div>
          )}

          {step === "error" && (
            <div className={styles.error} style={{ marginTop: 16 }}>
              {loadError}
            </div>
          )}

          {step === "pick_destination" && (
            <div style={{ marginTop: 20 }}>
              {destinationAccounts.length === 0 ? (
                <p className={styles.sub}>No other ad accounts available to copy into.</p>
              ) : (
                <>
                  <p className={styles.sub} style={{ marginBottom: 10 }}>
                    {level === "ad"
                      ? `Pick the ad account that already has the destination ad set — its creative, Page, and copy carry over, nothing else in that ad set is touched. ${destinationAccounts.length} account${destinationAccounts.length === 1 ? "" : "s"} available.`
                      : level === "adset" && isMultiAdset
                      ? `Pick the ad account that has the destination campaign you'll add these ${sourceAdsetList.length} ad sets to. ${destinationAccounts.length} account${destinationAccounts.length === 1 ? "" : "s"} available.`
                      : `Pick the ad account to create the new ${level === "adset" ? "ad set" : "campaign"} in${isMultiCampaign ? ` — used for all ${sourceCampaignList.length} selected campaigns` : ""}. ${destinationAccounts.length} account${destinationAccounts.length === 1 ? "" : "s"} available.`}
                  </p>
                  <AccountSelect accounts={destinationAccounts} value={destAccountId} onChange={pickDestAccount} placeholder="Select an ad account…" usePortal zIndex={900} />
                </>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
                <button type="button" className={styles.btnSecondary} onClick={onClose}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {step === "choose_campaign_mode" && (
            <div style={{ marginTop: 16 }}>
              <BackLink onClick={() => setStep("pick_destination")} />
              <p className={styles.sub} style={{ marginBottom: 14 }}>
                Into: {destAccountName}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  type="button"
                  className={styles.card}
                  style={{ padding: 14, textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}
                  onClick={() => {
                    setDestinationMode("new_campaign");
                    setStep("review");
                  }}
                >
                  <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>Create a new campaign matching the source</p>
                  <p className={styles.sub} style={{ margin: 0 }}>
                    Clones &quot;{adsetSourceCampaignFields?.fields?.name?.replace(/ - Copy$/, "") || "the source ad set's campaign"}&quot; into {destAccountName}.
                  </p>
                </button>
                <button
                  type="button"
                  className={styles.card}
                  style={{ padding: 14, textAlign: "left", cursor: "pointer", border: "1px solid var(--border)" }}
                  onClick={() => {
                    setDestinationMode("existing_campaign");
                    setCampaignQuery("");
                    loadDestCampaigns(destAccountId);
                    setStep("pick_campaign");
                  }}
                >
                  <p style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>Add to an existing campaign</p>
                  <p className={styles.sub} style={{ margin: 0 }}>
                    Pick a campaign that already exists in {destAccountName}.
                  </p>
                </button>
              </div>
            </div>
          )}

          {step === "pick_campaign" && (
            <div style={{ marginTop: 16 }}>
              <BackLink onClick={() => setStep(isMultiAdset ? "pick_destination" : "choose_campaign_mode")} />
              {isMultiAdset && (
                <p className={styles.sub} style={{ marginBottom: 10 }}>
                  Into: {destAccountName} — pick the existing campaign to add all {sourceAdsetList.length} ad sets to.
                </p>
              )}
              {destCampaignsLoading && <Loader label="Loading campaigns…" />}
              {destCampaignsError && <div className={styles.error}>{destCampaignsError}</div>}
              {!destCampaignsLoading && !destCampaignsError && (
                <CampaignPickerList campaigns={destCampaigns} query={campaignQuery} onQueryChange={setCampaignQuery} onPick={pickDestCampaign} />
              )}
            </div>
          )}

          {step === "pick_adset" && (
            <div style={{ marginTop: 16 }}>
              <BackLink onClick={() => setStep("pick_destination")} />
              <p className={styles.sub} style={{ marginBottom: 10 }}>
                Into: {destAccountName}
              </p>
              {adsetsLoading && <Loader label="Loading ad sets…" />}
              {adsetsError && <div className={styles.error}>{adsetsError}</div>}
              {!adsetsLoading && !adsetsError && (
                <>
                  <p className={styles.muted} style={{ marginBottom: 8 }}>
                    Pick one or more ad sets — every selected ad is copied into each of them.
                  </p>
                  <AdsetPickerList adsets={adsets} query={adsetQuery} onQueryChange={setAdsetQuery} selectedIds={new Set(destAdsets.map((a) => a.id))} onToggle={toggleDestAdset} />
                  <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                    <button type="button" className={styles.btnPrimary} disabled={destAdsets.length === 0} onClick={() => setStep("review")}>
                      Continue{destAdsets.length > 0 ? ` (${destAdsets.length} ad set${destAdsets.length === 1 ? "" : "s"})` : ""}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {step === "review" && level === "ad" && (
            <div style={{ marginTop: 16 }}>
              {!submitting && <BackLink onClick={() => setStep("pick_adset")} />}
              <p className={styles.sub} style={{ marginBottom: 14 }}>
                Into {destAdsets.length === 1 ? `"${destAdsets[0].name}"` : `${destAdsets.length} ad sets`} ({destAccountName})
              </p>

              {!submitting && (
                <>
                  <Section icon={CopyIcon} title={`${ads.length} ad${ads.length === 1 ? "" : "s"} to copy`}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                      {ads.map((ad) => (
                        <div key={ad.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 8px", borderRadius: 8, background: "var(--bg)" }}>
                          <Thumb src={ad.thumbnailUrl} isVideo={ad.isVideo} size={32} onClick={() => setLightboxItem({ id: ad.id, name: ad.name, thumbnailUrl: ad.thumbnailUrl, isVideo: ad.isVideo })} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p className={styles.muted} style={{ fontSize: 11, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {ad.name}
                            </p>
                            <input type="text" className={styles.select} style={{ width: "100%" }} value={names[ad.id] || ""} onChange={(e) => setNames((prev) => ({ ...prev, [ad.id]: e.target.value }))} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </Section>

                  <Section icon={CheckIcon} title="Status after copying">
                    <div className={styles.tabGroup}>
                      <button type="button" className={status === "PAUSED" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("PAUSED")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PauseIcon size={12} />
                          Paused — review before spending
                        </span>
                      </button>
                      <button type="button" className={status === "ACTIVE" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("ACTIVE")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PlayIcon size={12} />
                          Active immediately
                        </span>
                      </button>
                    </div>
                  </Section>
                </>
              )}

              {submitting && (
                <Section icon={ListIcon} title="Copying your ads">
                  {(() => {
                    const doneCount = Object.values(adProgress).filter((p) => p.phase === "success" || p.phase === "failed" || p.phase === "skipped").length;
                    return doneCount < ads.length ? <Loader inline label={`${doneCount} of ${ads.length} done`} /> : <p className={styles.sub}>{doneCount} of {ads.length} done</p>;
                  })()}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto", marginTop: 10 }}>
                    {ads.map((ad) => {
                      const p = adProgress[ad.id] || { phase: "queued" };
                      return (
                        <div key={ad.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--bg)" }}>
                          <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{ad.name}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            <span className={PHASE_BADGE_CLASS[p.phase] || styles.badgeInfo}>{PHASE_LABEL[p.phase] || "Queued"}</span>
                            {p.phase === "success" && p.newAdId && <CopyIdButton id={p.newAdId} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
              {submitError && <div className={styles.error}>{submitError}</div>}

              <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
                <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button type="button" className={styles.btnPrimary} onClick={handleConfirmAd} disabled={submitting}>
                  {submitting ? "Copying…" : `Copy ${ads.length} ad${ads.length === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          )}

          {step === "review" && level === "adset" && !isMultiAdset && newAdsetFields && (
            <div style={{ marginTop: 16 }}>
              {!submitting && <BackLink onClick={() => setStep(destinationMode === "new_campaign" ? "choose_campaign_mode" : "pick_campaign")} />}
              <p className={styles.sub} style={{ marginBottom: 14 }}>
                Into {destAccountName}
                {destinationMode === "existing_campaign" && destCampaign ? ` — "${destCampaign.name}"` : " — a new campaign"}
              </p>

              {!submitting && (
                <>
                  {destinationMode === "new_campaign" && newCampaignFields && (
                    <Section icon={DatabaseIcon} title="New campaign (matching the source)">
                      <CampaignFields value={newCampaignFields} onChange={setNewCampaignFields} />
                    </Section>
                  )}

                  {campaignBudget.budgetStrategy === "ABO" && (
                    <Section icon={DatabaseIcon} title={`New ad set's ${campaignBudget.budgetType === "LIFETIME" ? "lifetime" : "daily"} budget`}>
                      <input
                        type="number"
                        min="1"
                        className={styles.select}
                        style={{ width: "100%" }}
                        value={campaignBudget.budgetAmount}
                        onChange={(e) => setCampaignBudget((prev) => ({ ...prev, budgetAmount: e.target.value }))}
                      />
                    </Section>
                  )}

                  <Section icon={ListIcon} title="New ad set (matching the source)">
                    <AdSetFields value={newAdsetFields} onChange={setNewAdsetFields} campaignObjective={newCampaignFields?.objective} accountId={destAccountId} pixels={destPixels} />
                  </Section>

                  <Section icon={CopyIcon} title={`${selectedSourceAdIds.size} of ${sourceAdItems.length} ad${sourceAdItems.length === 1 ? "" : "s"} to copy`}>
                    <AdChecklist
                      ads={sourceAdItems}
                      selectedIds={selectedSourceAdIds}
                      onToggle={toggleSourceAd}
                      onPreview={(ad) => setLightboxItem({ id: ad.id, name: ad.name, thumbnailUrl: ad.thumbnailUrl, isVideo: ad.isVideo })}
                    />
                  </Section>

                  <Section icon={CheckIcon} title="Status after copying">
                    <div className={styles.tabGroup}>
                      <button type="button" className={status === "PAUSED" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("PAUSED")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PauseIcon size={12} />
                          Paused — review before spending
                        </span>
                      </button>
                      <button type="button" className={status === "ACTIVE" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("ACTIVE")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PlayIcon size={12} />
                          Active immediately
                        </span>
                      </button>
                    </div>
                  </Section>
                </>
              )}

              {submitting && (
                <Section icon={ListIcon} title="Copying your ad set">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                    {objectProgress.campaign && <StepRow step={{ type: "campaign", label: `Campaign — ${objectProgress.campaign.name || ""}`, success: objectProgress.campaign.phase === "success", error: objectProgress.campaign.error, id: objectProgress.campaign.id }} />}
                    {objectProgress[singleSourceAdsetId] && (
                      <StepRow
                        step={{
                          type: "adset",
                          label: `Ad set — ${objectProgress[singleSourceAdsetId].name || ""}`,
                          success: objectProgress[singleSourceAdsetId].phase === "success",
                          error: objectProgress[singleSourceAdsetId].error,
                          id: objectProgress[singleSourceAdsetId].id,
                        }}
                      />
                    )}
                  </div>
                  {(() => {
                    const total = Object.keys(adProgress).length;
                    const doneCount = Object.values(adProgress).filter((p) => p.phase === "success" || p.phase === "failed" || p.phase === "skipped").length;
                    return total > 0 ? doneCount < total ? <Loader inline label={`${doneCount} of ${total} ads done`} /> : <p className={styles.sub}>{doneCount} of {total} ads done</p> : null;
                  })()}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto", marginTop: 10 }}>
                    {Object.entries(adProgress).map(([adId, p]) => {
                      const ad = sourceAdItems.find((a) => a.id === adId);
                      return (
                        <div key={adId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "6px 8px", borderRadius: 8, background: "var(--bg)" }}>
                          <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{ad?.name || adId}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            <span className={PHASE_BADGE_CLASS[p.phase] || styles.badgeInfo}>{PHASE_LABEL[p.phase] || "Queued"}</span>
                            {p.phase === "success" && p.newAdId && <CopyIdButton id={p.newAdId} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}
              {submitError && <div className={styles.error}>{submitError}</div>}

              <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
                <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button type="button" className={styles.btnPrimary} onClick={handleConfirmAdset} disabled={!canSubmitAdset}>
                  {submitting ? "Copying…" : "Copy ad set"}
                </button>
              </div>
            </div>
          )}

          {step === "review" && level === "adset" && isMultiAdset && (
            <div style={{ marginTop: 16 }}>
              {!submitting && <BackLink onClick={() => setStep("pick_campaign")} />}
              <p className={styles.sub} style={{ marginBottom: 14 }}>
                Into {destAccountName} — &quot;{destCampaign?.name}&quot;
              </p>

              {!submitting && (
                <>
                  {!adsetEntriesLoaded && <Loader label="Loading ad sets…" />}

                  {adsetEntriesLoaded &&
                    adsetEntryOrder.map((adsetId) => {
                      const entry = adsetEntries[adsetId];
                      return (
                        <Section key={adsetId} icon={ListIcon} title={entry.fields?.name || entry.name}>
                          {entry.error ? (
                            <div className={styles.error}>{entry.error}</div>
                          ) : (
                            <>
                              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 10 }}>
                                <input type="checkbox" checked={entry.included} onChange={() => toggleAdsetEntryIncluded(adsetId)} />
                                Include this ad set
                              </label>
                              {entry.included && campaignBudget.budgetStrategy === "ABO" && (
                                <div style={{ marginBottom: 10 }}>
                                  <p className={styles.sub} style={{ marginBottom: 4 }}>
                                    {campaignBudget.budgetType === "LIFETIME" ? "Lifetime" : "Daily"} budget
                                  </p>
                                  <input
                                    type="number"
                                    min="1"
                                    className={styles.select}
                                    style={{ width: "100%" }}
                                    value={entry.fields?.budgetAmount ?? ""}
                                    onChange={(e) => updateAdsetEntryBudget(adsetId, e.target.value)}
                                  />
                                </div>
                              )}
                              {entry.included && (
                                <AdChecklist
                                  ads={entry.ads}
                                  selectedIds={entry.selectedAdIds}
                                  onToggle={(adId, copyable) => toggleAdsetEntryAd(adsetId, adId, copyable)}
                                  onPreview={(ad) => setLightboxItem({ id: ad.id, name: ad.name, thumbnailUrl: ad.thumbnailUrl, isVideo: ad.isVideo })}
                                />
                              )}
                            </>
                          )}
                        </Section>
                      );
                    })}

                  <Section icon={CheckIcon} title="Status after copying">
                    <div className={styles.tabGroup}>
                      <button type="button" className={status === "PAUSED" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("PAUSED")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PauseIcon size={12} />
                          Paused — review before spending
                        </span>
                      </button>
                      <button type="button" className={status === "ACTIVE" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("ACTIVE")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PlayIcon size={12} />
                          Active immediately
                        </span>
                      </button>
                    </div>
                  </Section>
                </>
              )}

              {submitting && (
                <Section icon={ListIcon} title="Copying your ad sets">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                    {adsetEntryOrder
                      .filter((id) => adsetEntries[id]?.included)
                      .map((adsetId) => {
                        const p = objectProgress[adsetId];
                        if (!p) return null;
                        return <StepRow key={adsetId} step={{ type: "adset", label: `Ad set — ${p.name || ""}`, success: p.phase === "success", error: p.error, id: p.id }} />;
                      })}
                  </div>
                  {(() => {
                    const total = Object.keys(adProgress).length;
                    const doneCount = Object.values(adProgress).filter((p) => p.phase === "success" || p.phase === "failed" || p.phase === "skipped").length;
                    return total > 0 ? doneCount < total ? <Loader inline label={`${doneCount} of ${total} ads done`} /> : <p className={styles.sub}>{doneCount} of {total} ads done</p> : null;
                  })()}
                </Section>
              )}
              {submitError && <div className={styles.error}>{submitError}</div>}

              <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
                <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button type="button" className={styles.btnPrimary} onClick={handleConfirmAdset} disabled={!canSubmitAdset}>
                  {submitting ? "Copying…" : `Copy ${adsetEntryOrder.filter((id) => adsetEntries[id]?.included).length} ad sets`}
                </button>
              </div>
            </div>
          )}

          {step === "review" && level === "campaign" && newCampaignFields && (
            <div style={{ marginTop: 16 }}>
              {!submitting && campaignQueueIndex === 0 && <BackLink onClick={() => setStep("pick_destination")} />}
              {isMultiCampaign && (
                <p className={styles.sub} style={{ marginBottom: 6, fontWeight: 600 }}>
                  Campaign {campaignQueueIndex + 1} of {sourceCampaignList.length}: {currentSourceCampaign?.name}
                </p>
              )}
              <p className={styles.sub} style={{ marginBottom: 14 }}>
                Into {destAccountName} — a new campaign with {campaignAdsetOrder.length} ad set{campaignAdsetOrder.length === 1 ? "" : "s"}
              </p>

              {!submitting && (
                <>
                  <Section icon={DatabaseIcon} title="New campaign (matching the source)">
                    <CampaignFields value={newCampaignFields} onChange={setNewCampaignFields} />
                  </Section>

                  {campaignBudget.budgetStrategy === "CBO" && (
                    <Section icon={DatabaseIcon} title={`Campaign's ${campaignBudget.budgetType === "LIFETIME" ? "lifetime" : "daily"} budget`}>
                      <input
                        type="number"
                        min="1"
                        className={styles.select}
                        style={{ width: "100%" }}
                        value={campaignBudget.budgetAmount}
                        onChange={(e) => setCampaignBudget((prev) => ({ ...prev, budgetAmount: e.target.value }))}
                      />
                    </Section>
                  )}

                  {!campaignAdsetsLoaded && <Loader label="Loading this campaign's ad sets…" />}

                  {campaignAdsetsLoaded &&
                    campaignAdsetOrder.map((adsetId) => {
                      const entry = campaignAdsets[adsetId];
                      return (
                        <Section key={adsetId} icon={ListIcon} title={entry.fields?.name || entry.name}>
                          {entry.error ? (
                            <div className={styles.error}>{entry.error}</div>
                          ) : (
                            <>
                              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 10 }}>
                                <input type="checkbox" checked={entry.included} onChange={() => toggleCampaignAdsetIncluded(adsetId)} />
                                Include this ad set
                              </label>
                              {entry.included && campaignBudget.budgetStrategy === "ABO" && (
                                <div style={{ marginBottom: 10 }}>
                                  <p className={styles.sub} style={{ marginBottom: 4 }}>
                                    {campaignBudget.budgetType === "LIFETIME" ? "Lifetime" : "Daily"} budget
                                  </p>
                                  <input
                                    type="number"
                                    min="1"
                                    className={styles.select}
                                    style={{ width: "100%" }}
                                    value={entry.fields?.budgetAmount ?? ""}
                                    onChange={(e) => updateCampaignAdsetBudget(adsetId, e.target.value)}
                                  />
                                </div>
                              )}
                              {entry.included && (
                                <AdChecklist
                                  ads={entry.ads}
                                  selectedIds={entry.selectedAdIds}
                                  onToggle={(adId, copyable) => toggleCampaignAdsetAd(adsetId, adId, copyable)}
                                  onPreview={(ad) => setLightboxItem({ id: ad.id, name: ad.name, thumbnailUrl: ad.thumbnailUrl, isVideo: ad.isVideo })}
                                />
                              )}
                            </>
                          )}
                        </Section>
                      );
                    })}

                  <Section icon={CheckIcon} title="Status after copying">
                    <div className={styles.tabGroup}>
                      <button type="button" className={status === "PAUSED" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("PAUSED")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PauseIcon size={12} />
                          Paused — review before spending
                        </span>
                      </button>
                      <button type="button" className={status === "ACTIVE" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("ACTIVE")}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <PlayIcon size={12} />
                          Active immediately
                        </span>
                      </button>
                    </div>
                  </Section>
                </>
              )}

              {submitting && (
                <Section icon={ListIcon} title="Copying your campaign">
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                    {objectProgress.campaign && <StepRow step={{ type: "campaign", label: `Campaign — ${objectProgress.campaign.name || ""}`, success: objectProgress.campaign.phase === "success", error: objectProgress.campaign.error, id: objectProgress.campaign.id }} />}
                    {campaignAdsetOrder
                      .filter((id) => campaignAdsets[id]?.included)
                      .map((adsetId) => {
                        const p = objectProgress[adsetId];
                        if (!p) return null;
                        return <StepRow key={adsetId} step={{ type: "adset", label: `Ad set — ${p.name || ""}`, success: p.phase === "success", error: p.error, id: p.id }} />;
                      })}
                  </div>
                  {(() => {
                    const total = Object.keys(adProgress).length;
                    const doneCount = Object.values(adProgress).filter((p) => p.phase === "success" || p.phase === "failed" || p.phase === "skipped").length;
                    return total > 0 ? doneCount < total ? <Loader inline label={`${doneCount} of ${total} ads done`} /> : <p className={styles.sub}>{doneCount} of {total} ads done</p> : null;
                  })()}
                </Section>
              )}
              {submitError && <div className={styles.error}>{submitError}</div>}

              <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
                <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={submitting}>
                  Cancel
                </button>
                <button type="button" className={styles.btnPrimary} onClick={handleConfirmCampaign} disabled={!canSubmitCampaign}>
                  {submitting ? "Copying…" : "Copy campaign"}
                </button>
              </div>
            </div>
          )}

          {step === "done" && result && level === "ad" && (() => {
            // Per-ad steps all carry the adId they came from; the batch-level
            // activation step (if any) doesn't, and used to just get mixed
            // into the same flat list at the end as a name-less "Activated —"
            // row — confusing, since it isn't about any one ad. Split here so
            // the per-ad list stays scannable and activation gets its own
            // clearly-labeled line.
            // One group per (ad, destination ad set) — the same ad lands once in each.
            const adStepsById = new Map();
            for (const s of result.steps) {
              if (!s.adId) continue;
              const key = `${s.adId}|${s.destAdsetId || ""}`;
              if (!adStepsById.has(key)) adStepsById.set(key, []);
              adStepsById.get(key).push(s);
            }
            const multiDest = destAdsets.length > 1;
            const activationStep = result.steps.find((s) => s.type === "activation");
            const isActive = status === "ACTIVE" && activationStep?.success;
            return (
              <div style={{ marginTop: 16 }}>
                <div className={result.success ? styles.success : styles.error} style={{ marginBottom: 14 }}>
                  <p style={{ marginBottom: 2 }}>{result.success ? "Copied successfully." : "Finished with some errors."}</p>
                  {result.error && <p style={{ fontWeight: 400, opacity: 0.85 }}>{result.error}</p>}
                  <p style={{ fontWeight: 400, opacity: 0.85 }}>
                    {result.createdAdIds.length} of {ads.length * destAdsets.length} ad{ads.length * destAdsets.length === 1 ? "" : "s"} created {isActive ? "and activated" : "paused"} in{" "}
                    {multiDest ? `${destAdsets.length} ad sets` : `"${destAdsets[0]?.name}"`} ({destAccountName}){!isActive && " — check Ads Manager before activating"}.
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...adStepsById.entries()].map(([key, steps]) => {
                    const adId = steps[0].adId;
                    const adsetName = destAdsets.find((a) => a.id === steps[0].destAdsetId)?.name;
                    return (
                      <div key={key}>
                        {multiDest && adsetName && (
                          <p className={styles.muted} style={{ fontSize: 11, margin: "2px 0 4px" }}>
                            → {adsetName}
                          </p>
                        )}
                        <CopiedAdGroup
                          steps={steps}
                          sourceAd={ads.find((a) => a.id === adId)}
                          newName={names[adId]}
                          onPreview={() => {
                            const a = ads.find((x) => x.id === adId);
                            if (a) setLightboxItem({ id: a.id, name: a.name, thumbnailUrl: a.thumbnailUrl, isVideo: a.isVideo });
                          }}
                        />
                      </div>
                    );
                  })}
                </div>

                {activationStep && !activationStep.success && (
                  <div className={styles.error} style={{ marginTop: 10 }}>
                    {activationStep.label}: {activationStep.error}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
                  <button type="button" className={styles.btnPrimary} onClick={onClose}>
                    Done
                  </button>
                </div>
              </div>
            );
          })()}

          {step === "done" && result && level === "adset" && (() => {
            const adStepsById = new Map();
            for (const s of result.steps) {
              if (!s.adId) continue;
              if (!adStepsById.has(s.adId)) adStepsById.set(s.adId, []);
              adStepsById.get(s.adId).push(s);
            }
            const topSteps = result.steps.filter((s) => s.type === "campaign" || s.type === "adset");
            const activationStep = result.steps.find((s) => s.type === "activation");
            const adSourceById = isMultiAdset
              ? new Map(adsetEntryOrder.flatMap((id) => (adsetEntries[id]?.ads || []).map((a) => [a.id, a])))
              : new Map(sourceAdItems.map((a) => [a.id, a]));
            return (
              <div style={{ marginTop: 16 }}>
                <div className={result.success ? styles.success : styles.error} style={{ marginBottom: 14 }}>
                  <p style={{ marginBottom: 2 }}>{result.success ? "Copied successfully." : "Finished with some errors."}</p>
                  {result.error && <p style={{ fontWeight: 400, opacity: 0.85 }}>{result.error}</p>}
                  <p style={{ fontWeight: 400, opacity: 0.85 }}>
                    {result.createdAdIds.length} ad{result.createdAdIds.length === 1 ? "" : "s"} created {status === "ACTIVE" && activationStep?.success ? "and activated" : "paused"} in {destAccountName}
                    {!(status === "ACTIVE" && activationStep?.success) && " — check Ads Manager before activating"}.
                  </p>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                  {topSteps.map((s, i) => (
                    <StepRow key={i} step={s} />
                  ))}
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[...adStepsById.entries()].map(([adId, steps]) => (
                    <CopiedAdGroup
                      key={adId}
                      steps={steps}
                      sourceAd={adSourceById.get(adId)}
                      newName={names[adId]}
                      onPreview={() => {
                        const a = adSourceById.get(adId);
                        if (a) setLightboxItem({ id: a.id, name: a.name, thumbnailUrl: a.thumbnailUrl, isVideo: a.isVideo });
                      }}
                    />
                  ))}
                </div>

                {activationStep && !activationStep.success && (
                  <div className={styles.error} style={{ marginTop: 10 }}>
                    {activationStep.label}: {activationStep.error}
                  </div>
                )}

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
                  <button type="button" className={styles.btnPrimary} onClick={onClose}>
                    Done
                  </button>
                </div>
              </div>
            );
          })()}

          {step === "done" && level === "campaign" && campaignResults.length > 0 && (() => {
            const allSucceeded = campaignResults.every((r) => r.result?.success);
            return (
              <div style={{ marginTop: 16 }}>
                {isMultiCampaign && (
                  <div className={allSucceeded ? styles.success : styles.error} style={{ marginBottom: 14 }}>
                    <p style={{ margin: 0 }}>
                      {campaignResults.filter((r) => r.result?.success).length} of {campaignResults.length} campaigns copied successfully into {destAccountName}.
                    </p>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {campaignResults.map(({ sourceCampaignId, sourceCampaignName, result: r, adSourceById, names: namesSnapshot }) => {
                    const adStepsById = new Map();
                    for (const s of r.steps) {
                      if (!s.adId) continue;
                      if (!adStepsById.has(s.adId)) adStepsById.set(s.adId, []);
                      adStepsById.get(s.adId).push(s);
                    }
                    const topSteps = r.steps.filter((s) => s.type === "campaign" || s.type === "adset");
                    const activationStep = r.steps.find((s) => s.type === "activation");
                    return (
                      <div key={sourceCampaignId} className={styles.card} style={{ padding: 14 }}>
                        <div className={r.success ? styles.success : styles.error} style={{ marginBottom: 10 }}>
                          <p style={{ marginBottom: 2 }}>
                            {sourceCampaignName} — {r.success ? "copied successfully" : "finished with some errors"}
                          </p>
                          {r.error && <p style={{ fontWeight: 400, opacity: 0.85 }}>{r.error}</p>}
                          <p style={{ fontWeight: 400, opacity: 0.85 }}>
                            {r.createdAdIds.length} ad{r.createdAdIds.length === 1 ? "" : "s"} created {status === "ACTIVE" && activationStep?.success ? "and activated" : "paused"}
                            {!(status === "ACTIVE" && activationStep?.success) && " — check Ads Manager before activating"}.
                          </p>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
                          {topSteps.map((s, i) => (
                            <StepRow key={i} step={s} />
                          ))}
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {[...adStepsById.entries()].map(([adId, steps]) => (
                            <CopiedAdGroup
                              key={adId}
                              steps={steps}
                              sourceAd={adSourceById.get(adId)}
                              newName={namesSnapshot[adId]}
                              onPreview={() => {
                                const a = adSourceById.get(adId);
                                if (a) setLightboxItem({ id: a.id, name: a.name, thumbnailUrl: a.thumbnailUrl, isVideo: a.isVideo });
                              }}
                            />
                          ))}
                        </div>

                        {activationStep && !activationStep.success && (
                          <div className={styles.error} style={{ marginTop: 10 }}>
                            {activationStep.label}: {activationStep.error}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
                  <button type="button" className={styles.btnPrimary} onClick={onClose}>
                    Done
                  </button>
                </div>
              </div>
            );
          })()}

          {step === "error" && (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button type="button" className={styles.btnSecondary} onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
      <CreativeLightbox item={lightboxItem} onClose={() => setLightboxItem(null)} />
    </>
  );
}
