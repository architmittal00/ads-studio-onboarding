import { useEffect, useState } from "react";
import Loader from "@/components/Loader";
import { ChevronIcon, RocketIcon } from "@/components/icons";
import { useAccounts } from "@/components/AccountProvider";
import { OPTIMIZATION_GOALS_BY_OBJECTIVE } from "@/components/AdSetFields";
import { useJsonFetch } from "@/lib/catalogAds/useJsonFetch";
import CatalogAdFields from "./CatalogAdFields";
import StandardAdFields from "./StandardAdFields";
import CatalogAudienceFields from "./CatalogAudienceFields";
import CatalogLaunchReview from "./CatalogLaunchReview";
import styles from "@/styles/Home.module.css";

// Same goal list components/AdSetFields.js already uses for a Sales-
// objective ad set (OUTCOME_SALES) — a standard ad from this wizard is
// always a Sales campaign, same as a catalog one.
const STANDARD_GOALS = OPTIMIZATION_GOALS_BY_OBJECTIVE.OUTCOME_SALES;

function defaultAdFields(catalog) {
  return {
    kind: catalog ? "CATALOG" : "UPLOAD",
    name: "",
    pageId: "",
    instagramUserId: "",
    format: "CAROUSEL",
    message: catalog ? "Still thinking about it? {{product.name}} is waiting for you." : "",
    headline: catalog ? "{{product.name}}" : "",
    description: catalog ? "{{product.current_price}}" : "",
    cta: "SHOP_NOW",
    link: "",
    imageHash: "",
    imageUrl: "",
    imageName: "",
    videoId: "",
    videoStatus: "",
    videoUrl: "",
    postSource: "FACEBOOK",
    postId: "",
  };
}

function defaultAdsetFields() {
  return {
    name: "",
    catalogAudienceMode: "RETARGET",
    retargetPreset: "VIEWED_OR_ATC",
    retargetEvents: ["ViewContent", "AddToCart"],
    retargetDays: 14,
    excludePurchasers: true,
    excludeDays: 14,
    crossSellSourceSetId: "",
    optimizationGoal: "OFFSITE_CONVERSIONS",
    customEventType: "PURCHASE",
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

function EntryCard({ title, description, onClick }) {
  return (
    <button type="button" onClick={onClick} className={styles.card} style={{ textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 8 }}>
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

// Four-step ad wizard: Ad -> Destination -> Setup -> Review & Launch —
// ported from sr-ads-launch's AdFirstWorkspace. Catalog ads shipped first
// (phase 4); phase 5 adds image and existing-post ads via the "Ad type"
// toggle below (video upload is still a later phase — see
// components/catalogads/StandardAdFields.js). Mirrors pages/launch.js's own
// screen-flow conventions (entry cards, a plain campaign/budget/audience
// form, NDJSON-streaming review) so it feels like the same app, not a
// bolted-on second launcher.
export default function CreateAdWizard({ accountId, currency, initialCatalogId, initialProductSetId }) {
  const { pages } = useAccounts();
  const pixelsRes = useJsonFetch(`/api/fb/targeting-data?accountId=${encodeURIComponent(accountId)}`);
  const pixels = pixelsRes.data?.pixels || [];

  const [screen, setScreen] = useState("ad");
  const [catalogId, setCatalogId] = useState(initialCatalogId || "");
  const [productSetId, setProductSetId] = useState(initialProductSetId || "");
  const [pixelId, setPixelId] = useState("");
  const [ad, setAd] = useState(() => defaultAdFields(true));

  const [destination, setDestination] = useState(null); // "new" | "existing"
  const [campaignName, setCampaignName] = useState("");
  const [bidStrategy, setBidStrategy] = useState("LOWEST_COST_WITHOUT_CAP");
  const [existingCampaign, setExistingCampaign] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [campaignsError, setCampaignsError] = useState(null);
  const [pickerQuery, setPickerQuery] = useState("");

  const [budgetType, setBudgetType] = useState("DAILY");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [adsetFields, setAdsetFields] = useState(defaultAdsetFields);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time seed from fetched data, same justified pattern as AccountProvider's own default-selection effects
    if (pixels.length === 1 && !pixelId) setPixelId(pixels[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- depends on pixelsRes.data (stable while unchanged), not the freshly-derived `pixels` array
  }, [pixelsRes.data, pixelId]);

  function resetFlow() {
    setScreen("ad");
    setCatalogId(initialCatalogId || "");
    setProductSetId(initialProductSetId || "");
    setAd(defaultAdFields(true));
    setDestination(null);
    setCampaignName("");
    setExistingCampaign(null);
    setBudgetType("DAILY");
    setBudgetAmount("");
    setAdsetFields(defaultAdsetFields());
    setPickerQuery("");
  }

  function loadCampaigns() {
    setCampaignsLoading(true);
    setCampaignsError(null);
    fetch(`/api/fb/campaigns-list?accountId=${encodeURIComponent(accountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setCampaignsError(json.error);
        // A catalog ad can only join a Sales-objective campaign — see
        // lib/catalogAds/launch.js's own campaign payload, which always sets
        // objective: "OUTCOME_SALES". This list endpoint doesn't carry
        // promoted_object, so a campaign using a *different* catalog can
        // still show up here; picking one surfaces Meta's own rejection at
        // launch time rather than silently misconfiguring anything (same
        // graceful-degradation precedent as lib/campaignLaunch.js's
        // special_ad_categories comment).
        else setCampaigns((json.campaigns || []).filter((c) => c.objective === "OUTCOME_SALES"));
      })
      .catch((err) => setCampaignsError(err.message))
      .finally(() => setCampaignsLoading(false));
  }

  function startNewCampaign() {
    setDestination("new");
    setScreen("setup");
  }
  function startExistingCampaign() {
    setPickerQuery("");
    loadCampaigns();
    setScreen("pick_campaign");
  }
  function pickCampaign(c) {
    setExistingCampaign(c);
    setDestination("existing");
    setScreen("setup");
  }

  const campaignHasOwnBudget = destination === "new" || !!(existingCampaign?.daily_budget || existingCampaign?.lifetime_budget);
  const budgetStrategy = campaignHasOwnBudget ? "CBO" : "ABO";

  const isCatalog = ad.kind === "CATALOG";
  const adReady = isCatalog
    ? !!(catalogId && productSetId && ad.name && ad.pageId && ad.message && ad.headline && ad.link)
    : ad.kind === "POST"
    ? !!(ad.name && ad.pageId && ad.postId)
    : !!(
        ad.name &&
        ad.pageId &&
        ad.imageHash &&
        ad.message &&
        ad.headline &&
        ad.link &&
        // A video must finish Meta's own processing before it can go into an
        // ad — "uploading"/"processing"/"error" all block Continue, same as
        // sr-ads-launch's own validateAd.
        (!ad.videoId || ad.videoStatus === "ready")
      );
  const setupReady = !!(adsetFields.name && budgetAmount && (destination === "existing" || campaignName) && (isCatalog || pixelId));

  const filteredCampaigns = pickerQuery.trim()
    ? campaigns.filter((c) => c.name.toLowerCase().includes(pickerQuery.trim().toLowerCase()))
    : campaigns;

  return (
    <div>
      {screen === "ad" && (
        <>
          <div style={{ marginBottom: 16 }}>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Ad type
            </p>
            <div className={styles.tabGroup}>
              <button
                type="button"
                className={ad.kind === "CATALOG" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => {
                  setAd(defaultAdFields(true));
                  setAdsetFields(defaultAdsetFields());
                }}
              >
                Catalog ad
              </button>
              <button
                type="button"
                className={ad.kind !== "CATALOG" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => {
                  setAd(defaultAdFields(false));
                  setAdsetFields({ ...defaultAdsetFields(), catalogAudienceMode: "BROAD", optimizationGoal: STANDARD_GOALS[0].value });
                }}
              >
                Image or existing post
              </button>
            </div>
          </div>

          {isCatalog ? (
            <CatalogAdFields
              accountId={accountId}
              pages={pages}
              pixels={pixels}
              catalogId={catalogId}
              onCatalogChange={(id) => {
                setCatalogId(id);
                setProductSetId("");
              }}
              productSetId={productSetId}
              onProductSetChange={setProductSetId}
              pixelId={pixelId}
              onPixelChange={setPixelId}
              value={ad}
              onChange={setAd}
            />
          ) : (
            <StandardAdFields accountId={accountId} pages={pages} value={ad} onChange={setAd} />
          )}

          <button type="button" className={styles.btnPrimary} style={{ marginTop: 16 }} disabled={!adReady} onClick={() => setScreen("destination")}>
            Continue
          </button>
        </>
      )}

      {screen === "destination" && (
        <div>
          <BackLink onClick={() => setScreen("ad")} label="Back to edit the ad" />
          <h2 className={styles.h2} style={{ marginBottom: 10 }}>
            Where should this run?
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <EntryCard
              title="New Campaign + Ad Set"
              description={`Create a brand-new Sales campaign${isCatalog ? " for this catalog" : ""}, and its first ad set.`}
              onClick={startNewCampaign}
            />
            <EntryCard title="New Ad Set → Existing Campaign" description="Add this ad set to a Sales campaign you already have." onClick={startExistingCampaign} />
          </div>
        </div>
      )}

      {screen === "pick_campaign" && (
        <div>
          <BackLink onClick={() => setScreen("destination")} />
          <h2 className={styles.h2} style={{ marginBottom: 10 }}>
            Choose a campaign
          </h2>
          <input
            type="text"
            className={styles.select}
            style={{ width: "100%", marginBottom: 10 }}
            placeholder="Search…"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
          />
          {campaignsLoading && <Loader label="Loading campaigns…" />}
          {!campaignsLoading && campaignsError && <div className={styles.error}>{campaignsError}</div>}
          {!campaignsLoading && !campaignsError && filteredCampaigns.length === 0 && (
            <p className={styles.sub}>No Sales-objective campaigns found on this account.</p>
          )}
          {!campaignsLoading && !campaignsError && filteredCampaigns.length > 0 && (
            <div className={styles.card} style={{ padding: 0, overflow: "hidden" }}>
              {filteredCampaigns.map((c) => (
                <div
                  key={c.id}
                  onClick={() => pickCampaign(c)}
                  style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 8 }}
                >
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{c.name}</div>
                  <span className={styles.badgeInfo} style={{ flexShrink: 0 }}>
                    {c.effective_status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {screen === "setup" && (
        <div>
          <BackLink onClick={() => setScreen("destination")} />
          {destination === "new" && (
            <>
              <h2 className={styles.h2} style={{ marginBottom: 10 }}>
                Campaign
              </h2>
              <div className={styles.card} style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 16 }}>
                <div>
                  <p className={styles.sub} style={{ marginBottom: 6 }}>
                    Campaign name
                  </p>
                  <input type="text" className={styles.select} style={{ width: "100%" }} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
                </div>
                <div>
                  <p className={styles.sub} style={{ marginBottom: 6 }}>
                    Bid strategy
                  </p>
                  <select className={styles.select} style={{ width: "100%" }} value={bidStrategy} onChange={(e) => setBidStrategy(e.target.value)}>
                    <option value="LOWEST_COST_WITHOUT_CAP">Highest volume (recommended)</option>
                    <option value="COST_CAP">Cost per result goal</option>
                    <option value="LOWEST_COST_WITH_BID_CAP">Bid cap</option>
                  </select>
                </div>
              </div>
            </>
          )}
          {destination === "existing" && (
            <p className={styles.sub} style={{ marginBottom: 20 }}>
              Attaching to existing campaign: <strong>{existingCampaign.name}</strong>
            </p>
          )}

          <h2 className={styles.h2} style={{ marginBottom: 10 }}>
            Budget
          </h2>
          <div className={styles.card} style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {!campaignHasOwnBudget && <p className={styles.sub}>This campaign has no campaign-level budget, so the ad set needs its own.</p>}
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
              placeholder="Enter an amount"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
            />
          </div>

          <h2 className={styles.h2} style={{ marginBottom: 10 }}>
            Ad Set
          </h2>
          <div className={styles.card} style={{ marginBottom: 20 }}>
            <CatalogAudienceFields
              value={adsetFields}
              onChange={setAdsetFields}
              accountId={accountId}
              catalogId={catalogId}
              isCatalog={isCatalog}
              pixels={pixels}
              pixelId={pixelId}
              onPixelChange={setPixelId}
              goalOptions={isCatalog ? undefined : STANDARD_GOALS}
            />
          </div>

          <button type="button" className={styles.btnPrimary} disabled={!setupReady} onClick={() => setScreen("review")}>
            Review &amp; Launch
          </button>
        </div>
      )}

      {screen === "review" && (
        <div>
          <BackLink onClick={() => setScreen("setup")} label="Back to edit" />
          <CatalogLaunchReview
            accountId={accountId}
            currency={currency}
            campaign={destination === "new" ? { name: campaignName, bidStrategy, catalogId: isCatalog ? catalogId : undefined } : null}
            existingCampaignId={destination === "existing" ? existingCampaign.id : null}
            existingCampaignName={destination === "existing" ? existingCampaign.name : null}
            budgetStrategy={budgetStrategy}
            budgetType={budgetType}
            budgetAmount={budgetAmount}
            adset={{
              ...adsetFields,
              campaignId: destination === "existing" ? existingCampaign.id : undefined,
              isCatalog,
              productSetId: isCatalog ? productSetId : undefined,
              pixelId: isCatalog ? undefined : pixelId,
            }}
            ad={ad}
            onBack={resetFlow}
          />
        </div>
      )}
    </div>
  );
}
