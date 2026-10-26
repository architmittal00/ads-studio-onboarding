import InterestPicker from "@/components/InterestPicker";
import CustomAudiencePicker from "@/components/CustomAudiencePicker";
import TargetingSearchPicker from "@/components/TargetingSearchPicker";
import { CATALOG_GOALS } from "@/lib/catalogAds/launch";
import { RETARGET_PRESETS, CATALOG_EVENTS } from "@/lib/catalogAds/retargetSpec";
import { useJsonFetch } from "@/lib/catalogAds/useJsonFetch";
import styles from "@/styles/Home.module.css";

const CUSTOM_EVENT_TYPES = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "ADD_TO_CART", label: "Add to cart" },
  { value: "INITIATE_CHECKOUT", label: "Initiate checkout" },
  { value: "VIEW_CONTENT", label: "View content" },
];

const PUBLISHER_PLATFORMS = [
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "messenger", label: "Messenger" },
  { value: "audience_network", label: "Audience Network" },
];
const FACEBOOK_POSITIONS = [
  { value: "feed", label: "Feed" },
  { value: "facebook_reels", label: "Reels" },
  { value: "story", label: "Stories" },
  { value: "video_feeds", label: "Video feeds" },
  { value: "marketplace", label: "Marketplace" },
  { value: "search", label: "Search results" },
];
const INSTAGRAM_POSITIONS = [
  { value: "stream", label: "Feed" },
  { value: "story", label: "Stories" },
  { value: "reels", label: "Reels" },
  { value: "explore", label: "Explore" },
];
const ATTRIBUTION_OPTIONS = [
  { value: "7D_CLICK_1D_VIEW", label: "7-day click or 1-day view (recommended)" },
  { value: "1D_CLICK_1D_VIEW", label: "1-day click or 1-day view" },
  { value: "1D_CLICK", label: "1-day click only" },
  { value: "7D_CLICK", label: "7-day click only" },
];

function toggleInList(list, item) {
  return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
}

function Checkbox({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5 }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

// Who a catalog ad set targets, plus placements and attribution — ported
// from sr-ads-launch's AudienceControls.tsx + the catalog branch of its own
// buildTargeting, adapted to this app's own field-naming convention. Reuses
// this app's existing InterestPicker/CustomAudiencePicker/TargetingSearchPicker
// (the same ones components/AdSetFields.js already uses for a normal ad
// set) for the "Broad audience" case — placement/location/age/gender
// controls are duplicated from AdSetFields.js rather than imported, so that
// file (the existing, working Launch tab) stays completely untouched by
// this feature.
export default function CatalogAudienceFields({ value, onChange, accountId, catalogId }) {
  function set(patch) {
    onChange({ ...value, ...patch });
  }

  const isRetarget = value.catalogAudienceMode === "RETARGET";
  const needsCustomCombo = value.retargetPreset === "CUSTOM";
  const needsSourceSet = value.retargetPreset === "UPSELL" || value.retargetPreset === "CROSS_SELL";

  const productSetsRes = useJsonFetch(needsSourceSet && catalogId ? `/api/fb/catalog-ads/product-sets?catalogId=${encodeURIComponent(catalogId)}` : null);
  const productSets = productSetsRes.data?.productSets || [];

  const needsCustomEvent = value.optimizationGoal === "OFFSITE_CONVERSIONS" || value.optimizationGoal === "VALUE";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Ad set name
        </p>
        <input type="text" className={styles.select} style={{ width: "100%" }} value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Performance goal
        </p>
        <select className={styles.select} style={{ width: "100%" }} value={value.optimizationGoal} onChange={(e) => set({ optimizationGoal: e.target.value })}>
          {CATALOG_GOALS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </div>

      {needsCustomEvent && (
        <div>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            Conversion event
          </p>
          <select className={styles.select} style={{ width: "100%" }} value={value.customEventType} onChange={(e) => set({ customEventType: e.target.value })}>
            {CUSTOM_EVENT_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Audience
        </p>
        <div className={styles.tabGroup}>
          <button
            type="button"
            className={isRetarget ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => set({ catalogAudienceMode: "RETARGET" })}
          >
            Retarget shoppers
          </button>
          <button
            type="button"
            className={!isRetarget ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => set({ catalogAudienceMode: "BROAD" })}
          >
            Broad audience
          </button>
        </div>
      </div>

      {isRetarget ? (
        <>
          <div>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Show products to people who
            </p>
            <select className={styles.select} style={{ width: "100%" }} value={value.retargetPreset} onChange={(e) => set({ retargetPreset: e.target.value })}>
              {RETARGET_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {needsCustomCombo && (
            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Include people who
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
                {CATALOG_EVENTS.map((ev) => (
                  <Checkbox
                    key={ev.key}
                    label={ev.label}
                    checked={value.retargetEvents.includes(ev.key)}
                    onChange={() => set({ retargetEvents: toggleInList(value.retargetEvents, ev.key) })}
                  />
                ))}
              </div>
              <Checkbox
                label="Exclude people who already purchased"
                checked={value.excludePurchasers}
                onChange={() => set({ excludePurchasers: !value.excludePurchasers })}
              />
            </div>
          )}

          {needsSourceSet && (
            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                {value.retargetPreset === "UPSELL" ? "Product set people interacted with" : "Product set people purchased from"}
              </p>
              <select
                className={styles.select}
                style={{ width: "100%" }}
                value={value.crossSellSourceSetId}
                onChange={(e) => set({ crossSellSourceSetId: e.target.value })}
              >
                <option value="" disabled>
                  Select a product set…
                </option>
                {productSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {!needsSourceSet && (
            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Within the last (days)
              </p>
              <input
                type="number"
                min="1"
                max="180"
                className={styles.select}
                style={{ width: 120 }}
                value={value.retargetDays}
                onChange={(e) => set({ retargetDays: Number(e.target.value) })}
              />
            </div>
          )}
          {needsCustomCombo && (
            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Exclude purchasers from the last (days)
              </p>
              <input
                type="number"
                min="1"
                max="180"
                className={styles.select}
                style={{ width: 120 }}
                value={value.excludeDays}
                onChange={(e) => set({ excludeDays: Number(e.target.value) })}
                disabled={!value.excludePurchasers}
              />
            </div>
          )}
        </>
      ) : (
        <>
          <div>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Audience type
            </p>
            <div className={styles.tabGroup} style={{ flexWrap: "wrap" }}>
              <button
                type="button"
                className={value.audienceType === "advantage_plus" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => set({ audienceType: "advantage_plus" })}
              >
                Advantage+ Audience
              </button>
              <button
                type="button"
                className={value.audienceType === "interest" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => set({ audienceType: "interest" })}
              >
                Interest-based
              </button>
              <button
                type="button"
                className={value.audienceType === "custom_audience" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                onClick={() => set({ audienceType: "custom_audience" })}
              >
                Custom Audience
              </button>
            </div>
          </div>
          {value.audienceType === "interest" && (
            <InterestPicker label="Interests" values={value.interests} onChange={(interests) => set({ interests })} suggested={[]} />
          )}
          {value.audienceType === "custom_audience" && (
            <CustomAudiencePicker accountId={accountId} values={value.customAudiences} onChange={(customAudiences) => set({ customAudiences })} />
          )}
        </>
      )}

      <TargetingSearchPicker
        label="Location targeting"
        type="adgeolocation"
        placeholder="Search countries, states, cities…"
        values={value.countries}
        onChange={(countries) => set({ countries })}
      />

      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            Min age
          </p>
          <select className={styles.select} style={{ width: "100%" }} value={value.ageMin} onChange={(e) => set({ ageMin: Number(e.target.value) })}>
            {Array.from({ length: 65 - 18 + 1 }, (_, i) => 18 + i).map((age) => (
              <option key={age} value={age}>
                {age}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            Max age
          </p>
          <select className={styles.select} style={{ width: "100%" }} value={value.ageMax} onChange={(e) => set({ ageMax: Number(e.target.value) })}>
            {Array.from({ length: 65 - 18 + 1 }, (_, i) => 18 + i).map((age) => (
              <option key={age} value={age}>
                {age === 65 ? "65+" : age}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Gender
        </p>
        <div className={styles.tabGroup}>
          {[
            { value: "all", label: "All" },
            { value: "male", label: "Male" },
            { value: "female", label: "Female" },
          ].map((g) => (
            <button
              key={g.value}
              type="button"
              className={value.gender === g.value ? `${styles.tab} ${styles.tabActive}` : styles.tab}
              onClick={() => set({ gender: g.value })}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <TargetingSearchPicker
        label="Language (leave empty for all languages)"
        type="adlocale"
        placeholder="Search languages…"
        values={value.languages}
        onChange={(languages) => set({ languages })}
      />

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Placement strategy
        </p>
        <div className={styles.tabGroup}>
          <button
            type="button"
            className={value.placementType === "ADVANTAGE_PLUS" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => set({ placementType: "ADVANTAGE_PLUS" })}
          >
            Advantage+ Placements
          </button>
          <button
            type="button"
            className={value.placementType === "MANUAL" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => set({ placementType: "MANUAL" })}
          >
            Manual Placements
          </button>
        </div>
      </div>

      {value.placementType === "MANUAL" && (
        <>
          <div>
            <p className={styles.sub} style={{ marginBottom: 6 }}>
              Publisher platforms
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
              {PUBLISHER_PLATFORMS.map((p) => (
                <Checkbox
                  key={p.value}
                  label={p.label}
                  checked={value.publisherPlatforms.includes(p.value)}
                  onChange={() => set({ publisherPlatforms: toggleInList(value.publisherPlatforms, p.value) })}
                />
              ))}
            </div>
          </div>

          {value.publisherPlatforms.includes("facebook") && (
            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Facebook placements
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {FACEBOOK_POSITIONS.map((p) => (
                  <Checkbox
                    key={p.value}
                    label={p.label}
                    checked={value.facebookPositions.includes(p.value)}
                    onChange={() => set({ facebookPositions: toggleInList(value.facebookPositions, p.value) })}
                  />
                ))}
              </div>
            </div>
          )}

          {value.publisherPlatforms.includes("instagram") && (
            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Instagram placements
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                {INSTAGRAM_POSITIONS.map((p) => (
                  <Checkbox
                    key={p.value}
                    label={p.label}
                    checked={value.instagramPositions.includes(p.value)}
                    onChange={() => set({ instagramPositions: toggleInList(value.instagramPositions, p.value) })}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Attribution setting
        </p>
        <select className={styles.select} style={{ width: "100%" }} value={value.attributionSetting} onChange={(e) => set({ attributionSetting: e.target.value })}>
          {ATTRIBUTION_OPTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
