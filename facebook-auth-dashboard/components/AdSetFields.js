import InterestPicker from "./InterestPicker";
import CustomAudiencePicker from "./CustomAudiencePicker";
import TargetingSearchPicker from "./TargetingSearchPicker";
import styles from "@/styles/Home.module.css";

// Which Performance Goal (optimization_goal) options are valid for a given
// campaign objective — Meta rejects a mismatched pairing at the API level,
// so this is live-derived from `campaignObjective` (the chosen or just-
// created campaign's real objective), not a fixed list. First entry in each
// is this form's default for that objective.
export const OPTIMIZATION_GOALS_BY_OBJECTIVE = {
  OUTCOME_SALES: [
    { value: "OFFSITE_CONVERSIONS", label: "Conversions" },
    { value: "VALUE", label: "Highest value" },
  ],
  OUTCOME_TRAFFIC: [
    { value: "LANDING_PAGE_VIEWS", label: "Landing page views" },
    { value: "LINK_CLICKS", label: "Link clicks" },
  ],
  OUTCOME_LEADS: [
    { value: "LEAD_GENERATION", label: "On-Facebook leads" },
    { value: "OFFSITE_CONVERSIONS", label: "Website leads (pixel)" },
  ],
  OUTCOME_ENGAGEMENT: [
    { value: "POST_ENGAGEMENT", label: "Post engagement" },
    { value: "PAGE_LIKES", label: "Page likes" },
    { value: "THRUPLAY", label: "Video views (ThruPlay)" },
  ],
  OUTCOME_AWARENESS: [
    { value: "REACH", label: "Reach" },
    { value: "IMPRESSIONS", label: "Impressions" },
    { value: "AD_RECALL_LIFT", label: "Ad recall lift" },
  ],
  OUTCOME_APP_PROMOTION: [
    { value: "APP_INSTALLS", label: "App installs" },
    { value: "OFFSITE_CONVERSIONS", label: "In-app events" },
  ],
};

const CUSTOM_EVENT_TYPES = [
  { value: "PURCHASE", label: "Purchase" },
  { value: "ADD_TO_CART", label: "Add to cart" },
  { value: "INITIATE_CHECKOUT", label: "Initiate checkout" },
  { value: "VIEW_CONTENT", label: "View content" },
  { value: "LEAD", label: "Lead" },
  { value: "COMPLETE_REGISTRATION", label: "Complete registration" },
];

const ATTRIBUTION_OPTIONS = [
  { value: "7D_CLICK_1D_VIEW", label: "7-day click or 1-day view (recommended)" },
  { value: "1D_CLICK_1D_VIEW", label: "1-day click or 1-day view" },
  { value: "1D_CLICK", label: "1-day click only" },
  { value: "7D_CLICK", label: "7-day click only" },
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

function Checkbox({ checked, onChange, label }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12.5 }}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function toggleInList(list, item) {
  return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
}

// Ad-set-level fields for the Launch tab — the big one, covering targeting,
// placements, and delivery settings. `campaignObjective` constrains the
// Performance Goal dropdown; `accountId`/`pixels` come from the page (pixels
// via the existing /api/fb/targeting-data, same source LaunchPanel.js uses).
export default function AdSetFields({ value, onChange, campaignObjective, accountId, pixels }) {
  function set(patch) {
    onChange({ ...value, ...patch });
  }

  const goalOptions = OPTIMIZATION_GOALS_BY_OBJECTIVE[campaignObjective] || OPTIMIZATION_GOALS_BY_OBJECTIVE.OUTCOME_SALES;
  const needsPixel = value.optimizationGoal === "OFFSITE_CONVERSIONS" || value.optimizationGoal === "LANDING_PAGE_VIEWS" || value.optimizationGoal === "VALUE";
  const needsCustomEvent = value.optimizationGoal === "OFFSITE_CONVERSIONS" || value.optimizationGoal === "VALUE";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Ad set name
        </p>
        <input
          type="text"
          className={styles.select}
          style={{ width: "100%" }}
          placeholder="e.g. Advantage+ Audience - Broad"
          value={value.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Performance goal
        </p>
        <select
          className={styles.select}
          style={{ width: "100%" }}
          value={value.optimizationGoal}
          onChange={(e) => set({ optimizationGoal: e.target.value })}
        >
          {goalOptions.map((g) => (
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
          <select
            className={styles.select}
            style={{ width: "100%" }}
            value={value.customEventType}
            onChange={(e) => set({ customEventType: e.target.value })}
          >
            {CUSTOM_EVENT_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {needsPixel && (
        <div>
          <p className={styles.sub} style={{ marginBottom: 6 }}>
            Pixel / dataset
          </p>
          <select className={styles.select} style={{ width: "100%" }} value={value.pixelId} onChange={(e) => set({ pixelId: e.target.value })}>
            <option value="" disabled>
              Select a pixel…
            </option>
            {pixels.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {pixels.length === 0 && (
            <p className={styles.sub} style={{ color: "var(--red)" }}>
              No pixel found on this account.
            </p>
          )}
        </div>
      )}

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
            Saved Audience
          </button>
        </div>
      </div>

      {value.audienceType === "interest" && (
        <InterestPicker label="Interests" values={value.interests} onChange={(interests) => set({ interests })} suggested={[]} />
      )}
      {value.audienceType === "custom_audience" && (
        <CustomAudiencePicker accountId={accountId} values={value.customAudiences} onChange={(customAudiences) => set({ customAudiences })} />
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
            {Array.from({ length: 65 - 13 + 1 }, (_, i) => 13 + i).map((age) => (
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
            {Array.from({ length: 65 - 13 + 1 }, (_, i) => 13 + i).map((age) => (
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
        <select
          className={styles.select}
          style={{ width: "100%" }}
          value={value.attributionSetting}
          onChange={(e) => set({ attributionSetting: e.target.value })}
        >
          {ATTRIBUTION_OPTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
        <p className={styles.sub} style={{ fontSize: 11.5, marginTop: 4 }}>
          Some ad accounts lock this at the account level — if so, Facebook&apos;s own rejection message shows up at launch time.
        </p>
      </div>
    </div>
  );
}
