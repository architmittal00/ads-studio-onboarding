import { useEffect, useRef, useState } from "react";
import InterestPicker from "./InterestPicker";
import Loader from "./Loader";
import styles from "@/styles/Home.module.css";

// Below this many distinct, revenue-positive landing pages in the last 30
// days, there isn't enough signal to bother asking the AI to analyze them —
// covers both a genuinely fresh account and a real one that just hasn't
// generated much trackable revenue yet.
const MIN_LANDING_PAGES_FOR_AI = 3;
// How long to wait after the user stops typing a brand URL before treating
// it as "done" and firing the AI call automatically.
const BRAND_URL_DEBOUNCE_MS = 1200;

function looksLikeUrl(str) {
  try {
    const u = new URL(str.includes("://") ? str : `https://${str}`);
    return u.hostname.includes(".");
  } catch {
    return false;
  }
}

// Strategy 8's interest-targeting step: each ad set gets its own live,
// Meta-search-backed, multi-select picker (InterestPicker) — usable on its
// own with zero AI involvement. AI recommendations (from the account's top
// landing pages, or a brand URL for accounts without enough of them) load
// automatically in the background — no button to click — and populate a
// shared "Suggested" list every picker shows inline, not hidden behind a
// search-triggered popup, so the user can see and add from everything the
// AI found rather than only whatever got auto-filled into each ad set.
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
  const [recommended, setRecommended] = useState(null); // matched[] — the shared suggested pool every picker reads from

  const hasFetchedForLandingPagesRef = useRef(false);
  const lastRecommendedUrlRef = useRef(null);

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

  async function fetchRecommendations(body) {
    setRecommending(true);
    setRecommendError(null);
    try {
      const res = await fetch("/api/fb/interest-recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);

      setRecommended(json.matched || []);
      // Only fill ad sets that are still empty — don't clobber a choice the
      // user already made by hand.
      json.matched?.forEach((m, i) => {
        if (i < interestChoices.length && interestChoices[i].length === 0) {
          setInterestChoice(i, [m]);
        }
      });
    } catch (err) {
      setRecommendError(err.message);
    } finally {
      setRecommending(false);
    }
  }

  // Auto-fires once landing pages are in — no button, no explicit call.
  // Guarded by a ref (not just state) so React's dev-mode double-invoke of
  // effects can't trigger two real OpenRouter calls.
  useEffect(() => {
    if (useBrandUrl || landingPagesLoading || hasFetchedForLandingPagesRef.current) return;
    if (!landingPages || landingPages.length === 0) return;
    hasFetchedForLandingPagesRef.current = true;
    // Kicks off an async fetch (which itself sets loading/error/result
    // state) — intentional, guarded by the ref above against double-firing,
    // not a derived-state anti-pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRecommendations({ source: "landing_pages", landingPages });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchRecommendations/interestChoices intentionally excluded, see guard above
  }, [useBrandUrl, landingPagesLoading, landingPages]);

  // Auto-fires for the brand-URL path once the user pauses on something that
  // parses as a real URL — and only once per distinct URL, so fixing a typo
  // re-triggers but an unrelated re-render doesn't.
  useEffect(() => {
    if (!useBrandUrl) return;
    const trimmed = brandUrl.trim();
    if (!looksLikeUrl(trimmed) || trimmed === lastRecommendedUrlRef.current) return;

    const timer = setTimeout(() => {
      lastRecommendedUrlRef.current = trimmed;
      fetchRecommendations({ source: "brand_url", brandUrl: trimmed });
    }, BRAND_URL_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchRecommendations/interestChoices intentionally excluded, see guard above
  }, [useBrandUrl, brandUrl]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Interest targeting
        </p>
        <p className={styles.sub} style={{ marginBottom: 10, fontSize: 11.5 }}>
          Each ad set can target one or more Meta interests — search directly below, or let AI suggestions (from{" "}
          {useBrandUrl ? "a brand URL" : "this account's top landing pages"}) load in the background.
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
          <p className={styles.sub} style={{ color: "#ff7070" }}>
            Couldn&apos;t get AI suggestions ({recommendError}) — you can still search for interests directly below.
          </p>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {interestChoices.map((values, i) => (
          <InterestPicker
            key={i}
            label={`Ad set ${i + 1} interest`}
            values={values}
            suggested={recommended}
            suggestedLoading={recommending && recommended === null}
            onChange={(newValues) => setInterestChoice(i, newValues)}
          />
        ))}
      </div>

      {duplicateInterestIds.length > 0 && (
        <p className={styles.sub} style={{ color: "#fbbf24" }}>
          The same interest is targeted by more than one ad set — Meta works best with distinct targeting here, but
          you can launch anyway.
        </p>
      )}
    </div>
  );
}
