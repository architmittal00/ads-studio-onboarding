import { useEffect, useState } from "react";
import InterestPicker from "./InterestPicker";
import Loader from "./Loader";
import styles from "@/styles/Home.module.css";

// Below this many distinct, revenue-positive landing pages in the last 30
// days, there isn't enough signal to bother asking the AI to analyze them —
// covers both a genuinely fresh account and a real one that just hasn't
// generated much trackable revenue yet.
const MIN_LANDING_PAGES_FOR_AI = 3;

// Strategy 8's interest-targeting step: each ad set gets its own live,
// Meta-search-backed picker (InterestPicker) — usable on its own with zero
// AI involvement — plus an optional "Get AI Recommendations" button that
// analyzes the account's top landing pages (or a brand URL, for accounts
// without enough of them) via Gemini and pre-fills the pickers with real,
// Meta-matched interests the user can still freely override.
export default function InterestTargetingSection({
  accountId,
  hasHistory,
  interestChoices,
  setInterestChoice,
  duplicateInterestIds,
}) {
  const [landingPages, setLandingPages] = useState(null);
  const [landingPagesLoading, setLandingPagesLoading] = useState(hasHistory !== false);
  const [brandUrl, setBrandUrl] = useState("");

  const [recommending, setRecommending] = useState(false);
  const [recommendError, setRecommendError] = useState(null);
  const [recommended, setRecommended] = useState(null); // matched[] from the API, used for "AI suggested" badges + prefill

  // hasHistory === false (fresh-marked account, from the Strategy page's own
  // signal) skips this fetch entirely — there's nothing to look up. A real
  // account still gets checked, since it might have too little trackable
  // revenue to be worth analyzing even though it's not explicitly "fresh".
  useEffect(() => {
    if (hasHistory === false) return;

    let ignore = false;
    fetch(`/api/fb/top-landing-pages?accountId=${encodeURIComponent(accountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (ignore) return;
        setLandingPages(json.landingPages || []);
      })
      .catch(() => {
        if (!ignore) setLandingPages([]);
      })
      .finally(() => {
        if (!ignore) setLandingPagesLoading(false);
      });

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only ever needs to run once per panel open
  }, []);

  const useBrandUrl = hasHistory === false || (landingPages !== null && landingPages.length < MIN_LANDING_PAGES_FOR_AI);
  const canRecommend = useBrandUrl ? brandUrl.trim().length > 0 : (landingPages?.length || 0) > 0;

  async function handleGetRecommendations() {
    setRecommending(true);
    setRecommendError(null);
    try {
      const res = await fetch("/api/fb/interest-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useBrandUrl ? { source: "brand_url", brandUrl: brandUrl.trim() } : { source: "landing_pages", landingPages }
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);

      setRecommended(json.matched || []);
      // Only fill empty slots — don't clobber a choice the user already made
      // by hand, including on a second click after changing something.
      json.matched?.forEach((m, i) => {
        if (i < interestChoices.length && !interestChoices[i]) {
          setInterestChoice(i, { id: m.id, name: m.name });
        }
      });
    } catch (err) {
      setRecommendError(err.message);
    } finally {
      setRecommending(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Interest targeting
        </p>
        <p className={styles.sub} style={{ marginBottom: 10, fontSize: 11.5 }}>
          Each ad set below targets its own Meta interest — search for one directly, or get AI-generated
          suggestions from {useBrandUrl ? "a brand URL" : "this account's top landing pages"} first.
        </p>

        {landingPagesLoading && <Loader inline label="Checking landing pages…" />}

        {!landingPagesLoading && useBrandUrl && (
          <input
            type="url"
            className={styles.select}
            style={{ width: "100%", marginBottom: 10 }}
            placeholder="https://brand.com"
            value={brandUrl}
            onChange={(e) => setBrandUrl(e.target.value)}
          />
        )}

        {!landingPagesLoading && !useBrandUrl && (
          <p className={styles.sub} style={{ marginBottom: 10, fontSize: 11.5 }}>
            Found {landingPages.length} landing page{landingPages.length === 1 ? "" : "s"} from the last 30 days.
          </p>
        )}

        {recommendError && (
          <p className={styles.sub} style={{ color: "#ff7070", marginBottom: 10 }}>
            {recommendError}
          </p>
        )}

        {!landingPagesLoading &&
          (recommending ? (
            <Loader inline label="Analyzing & matching Meta interests…" />
          ) : (
            <button
              type="button"
              className={styles.btnSecondary}
              disabled={!canRecommend}
              onClick={handleGetRecommendations}
            >
              Get AI Recommendations
            </button>
          ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {interestChoices.map((choice, i) => (
          <InterestPicker
            key={i}
            label={`Ad set ${i + 1} interest`}
            value={choice}
            recommended={recommended?.[i]}
            onChange={(c) => setInterestChoice(i, c)}
          />
        ))}
      </div>

      {duplicateInterestIds.length > 0 && (
        <p className={styles.sub} style={{ color: "#fbbf24" }}>
          Two ad sets have the same interest — Meta works best with distinct targeting here, but you can launch
          anyway.
        </p>
      )}
    </div>
  );
}
