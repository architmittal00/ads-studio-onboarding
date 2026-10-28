import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useRef, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import CampaignFields, { CAMPAIGN_OBJECTIVES } from "@/components/CampaignFields";
import AdSetFields, { OPTIMIZATION_GOALS_BY_OBJECTIVE } from "@/components/AdSetFields";
import LaunchReview from "@/components/LaunchReview";
import { useAccounts } from "@/components/AccountProvider";
import { RocketIcon, ChevronIcon } from "@/components/icons";
import { toMajorUnits } from "@/lib/reportShared";
import styles from "@/styles/Home.module.css";

// Flattened once for a bare optimization_goal -> human label lookup (the
// campaign/ad-set pickers show an existing object's goal without already
// knowing which objective category it came from, unlike AdSetFields.js's
// own dropdown which is scoped to one objective at a time). OFFSITE_CONVERSIONS
// appears under Sales/Leads/App Promotion with a different label each time —
// Object.fromEntries keeps the LAST occurrence for a repeated key, so the
// objectives are reversed first to make Sales's "Conversions" (the common
// case) win over App Promotion's "In-app events", rather than the reverse.
const OPTIMIZATION_GOAL_LABELS = Object.fromEntries(
  Object.values(OPTIMIZATION_GOALS_BY_OBJECTIVE)
    .reverse()
    .flat()
    .map((g) => [g.value, g.label])
);

function formatMoney(amount, currency) {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${amount.toFixed(0)} ${currency || ""}`;
  }
}

function budgetLabel(entity, currency) {
  if (entity.daily_budget) return `${formatMoney(toMajorUnits(entity.daily_budget), currency)}/day`;
  if (entity.lifetime_budget) return `${formatMoney(toMajorUnits(entity.lifetime_budget), currency)} lifetime`;
  return "No budget at this level";
}

// Last-30-day spend/purchases/ROAS, when the picker's insights call
// succeeded — the whole reason these pickers got metadata at all (a long
// list of similarly-named objects gives no basis to pick one over another
// without it). `null` performance (insights call failed) renders nothing
// rather than a misleading "no spend".
function PerformanceLine({ performance, currency }) {
  if (!performance) return null;
  if (!performance.spend) return <span className={styles.muted}>No spend in the last 30 days</span>;
  return (
    <span className={styles.muted}>
      {formatMoney(performance.spend, currency)} spent · {performance.purchases} purchases · {performance.roas.toFixed(1)}x ROAS (30d)
    </span>
  );
}

// Indian-D2C-sensible starting point for every new ad set — all of it stays
// editable in components/AdSetFields.js. See the plan's defaults table for
// the reasoning behind each one.
function defaultAdsetFields() {
  return {
    name: "",
    optimizationGoal: "OFFSITE_CONVERSIONS",
    customEventType: "PURCHASE",
    pixelId: "",
    audienceType: "advantage_plus",
    interests: [],
    customAudiences: [],
    countries: [{ key: "IN", name: "India", type: "country" }],
    ageMin: 18,
    ageMax: 65,
    gender: "all",
    languages: [],
    placementType: "ADVANTAGE_PLUS",
    publisherPlatforms: ["facebook", "instagram"],
    facebookPositions: ["feed", "story", "facebook_reels"],
    instagramPositions: ["stream", "story", "reels"],
    attributionSetting: "7D_CLICK_1D_VIEW",
  };
}

function defaultCampaignFields() {
  return { name: "", objective: "OUTCOME_SALES", advantagePlus: false, bidStrategy: "LOWEST_COST_WITHOUT_CAP" };
}

// Simple searchable list used by both the "existing campaign" and
// "duplicate an ad set" picker screens — not a reusable component since
// both callers need slightly different row content, kept inline here.
function PickerList({ loading, error, items, query, onQueryChange, renderRow, emptyLabel }) {
  const filtered = query.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
    : items;
  return (
    <div>
      <input
        type="text"
        className={styles.select}
        style={{ width: "100%", marginBottom: 10 }}
        placeholder="Search…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      {loading && <Loader label="Loading…" />}
      {!loading && error && <div className={styles.error}>{error}</div>}
      {!loading && !error && filtered.length === 0 && <p className={styles.sub}>{emptyLabel}</p>}
      {!loading && !error && (
        <div className={styles.card} style={{ padding: 0, overflow: "hidden" }}>
          {filtered.map((item) => renderRow(item))}
        </div>
      )}
    </div>
  );
}

export default function Launch() {
  const { adAccounts, accountsLoading, accountsError, selectedAccountId, setSelectedAccountId } = useAccounts();
  const currency = adAccounts.find((a) => a.id === selectedAccountId)?.currency;

  // screen: entry | pick_campaign | pick_adset | pick_destination | form | review
  const [screen, setScreen] = useState("entry");
  const [destination, setDestination] = useState(null); // "new" | "existing"
  const [existingCampaign, setExistingCampaign] = useState(null);
  const [sourceAdsetName, setSourceAdsetName] = useState(null);
  const [sourceAdsetCampaignName, setSourceAdsetCampaignName] = useState(null);
  // Ads to re-create under the new ad set once it exists — each one's
  // existing creative is reused by id (see pages/api/fb/adsets-list.js's
  // ?adsetId= detail fetch), not null outside the duplicate path.
  const [duplicateAds, setDuplicateAds] = useState([]);

  const [campaignFields, setCampaignFields] = useState(defaultCampaignFields);
  const [adsetFields, setAdsetFields] = useState(defaultAdsetFields);
  const [budgetType, setBudgetType] = useState("DAILY");
  const [budgetAmount, setBudgetAmount] = useState("");

  const [pixels, setPixels] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState(null);
  const [adsets, setAdsets] = useState([]);
  const [adsetsLoading, setAdsetsLoading] = useState(false);
  const [adsetsError, setAdsetsError] = useState(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const prevObjectiveRef = useRef(null);

  // An existing campaign that already has a campaign-level budget is CBO —
  // its ad sets can't also carry a budget. One with no budget at all is the
  // ABO shape (budget lives on each ad set instead). A brand-new campaign
  // is always CBO here (components/CampaignFields.js has no ABO toggle —
  // ABO only shows up when attaching to an existing ABO campaign, since
  // asking a first-time quick-launch user to split budget across ad sets
  // upfront adds a decision without adding value for a single new ad set).
  const campaignHasOwnBudget = destination === "new" || !!(existingCampaign?.daily_budget || existingCampaign?.lifetime_budget);
  const budgetStrategy = campaignHasOwnBudget ? "CBO" : "ABO";
  const campaignObjective = destination === "existing" ? existingCampaign?.objective : campaignFields.objective;

  // Clamp Performance Goal to whatever's valid whenever the campaign
  // objective changes (switching the dropdown in CampaignFields, or picking
  // a different existing campaign) — Meta rejects an incompatible pairing.
  useEffect(() => {
    if (!campaignObjective || prevObjectiveRef.current === campaignObjective) return;
    prevObjectiveRef.current = campaignObjective;
    const valid = OPTIMIZATION_GOALS_BY_OBJECTIVE[campaignObjective] || OPTIMIZATION_GOALS_BY_OBJECTIVE.OUTCOME_SALES;
    if (!valid.some((g) => g.value === adsetFields.optimizationGoal)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reacting to an external input (objective) changing, same justification as other clamp effects in this app
      setAdsetFields((prev) => ({ ...prev, optimizationGoal: valid[0].value }));
    }
  }, [campaignObjective, adsetFields.optimizationGoal]);

  useEffect(() => {
    if (!selectedAccountId) return;
    fetch(`/api/fb/targeting-data?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then((res) => res.json())
      .then((json) => {
        setPixels(json.pixels || []);
        if (json.pixels?.length === 1) setAdsetFields((prev) => ({ ...prev, pixelId: json.pixels[0].id }));
      })
      .catch(() => {});
  }, [selectedAccountId]);

  function loadCampaigns() {
    setCampaignsLoading(true);
    setCampaignsError(null);
    fetch(`/api/fb/campaigns-list?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setCampaignsError(json.error);
        else setCampaigns(json.campaigns || []);
      })
      .catch((err) => setCampaignsError(err.message))
      .finally(() => setCampaignsLoading(false));
  }

  function loadAdsets() {
    setAdsetsLoading(true);
    setAdsetsError(null);
    fetch(`/api/fb/adsets-list?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setAdsetsError(json.error);
        else setAdsets(json.adsets || []);
      })
      .catch((err) => setAdsetsError(err.message))
      .finally(() => setAdsetsLoading(false));
  }

  function resetFlow() {
    setScreen("entry");
    setDestination(null);
    setExistingCampaign(null);
    setSourceAdsetName(null);
    setSourceAdsetCampaignName(null);
    setDuplicateAds([]);
    setCampaignFields(defaultCampaignFields());
    setAdsetFields(defaultAdsetFields());
    setBudgetType("DAILY");
    setBudgetAmount("");
    setPickerQuery("");
  }

  function startNewCampaign() {
    setDestination("new");
    setScreen("form");
  }
  function startExistingCampaign() {
    setDestination("existing");
    setPickerQuery("");
    loadCampaigns();
    setScreen("pick_campaign");
  }
  function startDuplicate() {
    setPickerQuery("");
    loadAdsets();
    setScreen("pick_adset");
  }

  function pickCampaign(c) {
    setExistingCampaign(c);
    setDestination("existing");
    setScreen("form");
  }

  // Fetches one ad set's full settings + its ads (pages/api/fb/adsets-list.js's
  // ?adsetId= detail shape) and lands on the destination picker — shared by
  // the normal "Choose an ad set to duplicate" picker (pickSourceAdset below)
  // and the Explore-row-action shortcut (handleDuplicateQuery), which skips
  // straight here already knowing the id.
  function loadSourceAdsetById(id) {
    setAdsetsLoading(true);
    setAdsetsError(null);
    fetch(`/api/fb/adsets-list?adsetId=${encodeURIComponent(id)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) {
          setAdsetsError(json.error);
          return;
        }
        setAdsetFields(json.fields);
        setSourceAdsetName(json.name);
        setSourceAdsetCampaignName(json.campaignName);
        setDuplicateAds(json.ads || []);
        setScreen("pick_destination");
      })
      .catch((err) => setAdsetsError(err.message))
      .finally(() => setAdsetsLoading(false));
  }

  function pickSourceAdset(a) {
    loadSourceAdsetById(a.id);
  }

  const runnable = !!selectedAccountId;

  return (
    <Layout>
      <Head>
        <title>Launch · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 900, margin: "0 auto" }}>
          <h1 className={styles.h1}>Launch</h1>
          <p className={styles.sub} style={{ marginTop: -8, marginBottom: 20 }}>
            Launch a campaign and ad set straight to Facebook — pre-filled for Indian D2C, every field editable.
          </p>

          {accountsError && <div className={styles.error}>Error loading ad accounts: {accountsError}</div>}

          <div className={styles.card} style={{ marginBottom: 20 }}>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Ad account
            </p>
            <AccountSelect accounts={adAccounts} value={selectedAccountId} onChange={setSelectedAccountId} placeholder="Select an ad account…" loading={accountsLoading} />
          </div>

          {!runnable && <p className={styles.sub}>Pick an ad account above to get started.</p>}

          {runnable && screen === "entry" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              <EntryCard
                title="New Campaign + Ad Set"
                description="Create a brand-new campaign and its first ad set together."
                onClick={startNewCampaign}
              />
              <EntryCard
                title="New Ad Set → Existing Campaign"
                description="Add a new ad set to a campaign you already have."
                onClick={startExistingCampaign}
              />
              <EntryCard
                title="Duplicate an Ad Set"
                description="Copy an existing ad set's settings into a new or existing campaign."
                onClick={startDuplicate}
              />
            </div>
          )}

          {screen === "pick_campaign" && (
            <div>
              <BackLink onClick={resetFlow} />
              <h2 className={styles.h2} style={{ marginBottom: 10 }}>
                Choose a campaign
              </h2>
              <PickerList
                loading={campaignsLoading}
                error={campaignsError}
                items={campaigns}
                query={pickerQuery}
                onQueryChange={setPickerQuery}
                emptyLabel="No campaigns found on this account."
                renderRow={(c) => (
                  <div
                    key={c.id}
                    onClick={() => pickCampaign(c)}
                    style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                      <span className={styles.muted}>
                        {CAMPAIGN_OBJECTIVES.find((o) => o.value === c.objective)?.label || c.objective} · {budgetLabel(c, currency)}
                      </span>
                      <PerformanceLine performance={c.performance} currency={currency} />
                    </div>
                    <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                      {c.effective_status}
                    </span>
                  </div>
                )}
              />
            </div>
          )}

          {screen === "pick_adset" && (
            <div>
              <BackLink onClick={resetFlow} />
              <h2 className={styles.h2} style={{ marginBottom: 10 }}>
                Choose an ad set to duplicate
              </h2>
              <PickerList
                loading={adsetsLoading}
                error={adsetsError}
                items={adsets}
                query={pickerQuery}
                onQueryChange={setPickerQuery}
                emptyLabel="No ad sets found on this account."
                renderRow={(a) => (
                  <div
                    key={a.id}
                    onClick={() => pickSourceAdset(a)}
                    style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</div>
                      <span className={styles.muted}>
                        {a.campaign?.name} · {OPTIMIZATION_GOAL_LABELS[a.optimization_goal] || a.optimization_goal} · {budgetLabel(a, currency)}
                      </span>
                      <PerformanceLine performance={a.performance} currency={currency} />
                    </div>
                    <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                      {a.status}
                    </span>
                  </div>
                )}
              />
            </div>
          )}

          {screen === "pick_destination" && (
            <div>
              {/* Goes all the way back to the entry screen rather than just
                  to "pick_adset" — this screen is also reached directly via
                  Explore's "Duplicate" row action, which never populated
                  that picker's list in the first place, so "one step back"
                  isn't always a real, loaded screen to land on. Matches the
                  label this already shows ("Start over"). */}
              <BackLink onClick={resetFlow} />
              <h2 className={styles.h2} style={{ marginBottom: 6 }}>
                Where should the duplicate go?
              </h2>
              <p className={styles.sub} style={{ marginBottom: 14 }}>
                Duplicating &ldquo;{sourceAdsetName}&rdquo;
                {sourceAdsetCampaignName && <> (currently in <strong>{sourceAdsetCampaignName}</strong>)</>} — its settings are
                pre-filled below, still fully editable.
                {duplicateAds.length > 0 &&
                  ` Its ${duplicateAds.length} ad${duplicateAds.length > 1 ? "s" : ""} will be duplicated into the new ad set too, using the same creative.`}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
                <EntryCard title="New Campaign" description="Create a new campaign for this ad set." onClick={startNewCampaign} />
                <EntryCard title="Existing Campaign" description="Attach it to a campaign you already have." onClick={startExistingCampaign} />
              </div>
            </div>
          )}

          {screen === "form" && (
            <div>
              <BackLink onClick={resetFlow} />
              {destination === "new" && (
                <>
                  <h2 className={styles.h2} style={{ marginBottom: 10 }}>
                    Campaign
                  </h2>
                  <div className={styles.card} style={{ marginBottom: 20 }}>
                    <CampaignFields value={campaignFields} onChange={setCampaignFields} />
                  </div>
                </>
              )}
              {destination === "existing" && (
                <p className={styles.sub} style={{ marginBottom: 20 }}>
                  Attaching to existing campaign: <strong>{existingCampaign.name}</strong> ({CAMPAIGN_OBJECTIVES.find((o) => o.value === existingCampaign.objective)?.label || existingCampaign.objective})
                </p>
              )}

              <h2 className={styles.h2} style={{ marginBottom: 10 }}>
                Budget
              </h2>
              <div className={styles.card} style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 12 }}>
                {!campaignHasOwnBudget && (
                  <p className={styles.sub}>This campaign has no campaign-level budget, so the ad set needs its own.</p>
                )}
                <div className={styles.tabGroup}>
                  <button type="button" className={budgetType === "DAILY" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setBudgetType("DAILY")}>
                    Daily budget
                  </button>
                  <button type="button" className={budgetType === "LIFETIME" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setBudgetType("LIFETIME")}>
                    Lifetime budget
                  </button>
                </div>
                <input
                  type="number"
                  min="1"
                  className={styles.select}
                  style={{ width: "100%" }}
                  placeholder="Enter an amount (₹)"
                  value={budgetAmount}
                  onChange={(e) => setBudgetAmount(e.target.value)}
                />
              </div>

              <h2 className={styles.h2} style={{ marginBottom: 10 }}>
                Ad Set
              </h2>
              <div className={styles.card} style={{ marginBottom: 20 }}>
                <AdSetFields value={adsetFields} onChange={setAdsetFields} campaignObjective={campaignObjective} accountId={selectedAccountId} pixels={pixels} />
              </div>

              <button
                type="button"
                className={styles.btnPrimary}
                disabled={!adsetFields.name || (destination === "new" && !campaignFields.name) || !budgetAmount}
                onClick={() => setScreen("review")}
              >
                Review &amp; Launch
              </button>
            </div>
          )}

          {screen === "review" && (
            <div>
              <BackLink onClick={() => setScreen("form")} label="Back to edit" />
              <LaunchReview
                accountId={selectedAccountId}
                campaign={destination === "new" ? campaignFields : null}
                existingCampaignId={destination === "existing" ? existingCampaign.id : null}
                existingCampaignName={destination === "existing" ? existingCampaign.name : null}
                budgetStrategy={budgetStrategy}
                budgetType={budgetType}
                budgetAmount={budgetAmount}
                adset={adsetFields}
                duplicateAds={duplicateAds}
                onBack={resetFlow}
              />
            </div>
          )}
        </main>
      </div>
    </Layout>
  );
}

function EntryCard({ title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={styles.card}
      style={{ textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8 }}
    >
      <RocketIcon size={18} />
      <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
      <span className={styles.sub}>{description}</span>
    </button>
  );
}

function BackLink({ onClick, label = "Start over" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", color: "var(--t2)", fontSize: 12.5, padding: 0, marginBottom: 14 }}
    >
      <ChevronIcon direction="left" size={12} />
      {label}
    </button>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: { session: publicSession(session) } };
}
