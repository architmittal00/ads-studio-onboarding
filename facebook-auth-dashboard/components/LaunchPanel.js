import { useEffect, useState } from "react";
import { CloseIcon } from "./icons";
import Loader from "./Loader";
import { getPixelMapping, setPixelMapping } from "@/lib/clientStorage";
import styles from "@/styles/Home.module.css";

// Review & Launch panel for one strategy: picks the Page (and, the first
// time for this account, the pixel — remembered after that via
// lib/clientStorage's pixel mapping), a Paused/Active choice, then posts to
// /api/fb/launch-strategy and shows exactly what was created or failed.
// Country (India) and lookalike ratio (1%) aren't asked here — hardcoded
// per the current scope, see lib/campaignLaunch.js.
export default function LaunchPanel({ strategy, accountId, dailyBudget, onClose }) {
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [pages, setPages] = useState([]);
  const [pixels, setPixels] = useState([]);

  const [pageId, setPageId] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [status, setStatus] = useState("PAUSED");

  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    let ignore = false;
    // Standard fetch-on-mount pattern, same as every other data-fetching
    // effect in this app — resetting loading/error state synchronously here
    // is intentional, not a sync-derived-state bug.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingData(true);
    setDataError(null);

    fetch(`/api/fb/targeting-data?accountId=${encodeURIComponent(accountId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (ignore) return;
        if (json.error) {
          setDataError(json.error);
          return;
        }
        setPages(json.pages || []);
        setPixels(json.pixels || []);
        if (json.pages?.length === 1) setPageId(json.pages[0].id);

        const stored = getPixelMapping(accountId);
        if (stored && (json.pixels || []).some((p) => p.id === stored)) {
          setPixelId(stored);
        } else if (json.pixels?.length === 1) {
          setPixelId(json.pixels[0].id);
          setPixelMapping(accountId, json.pixels[0].id);
        }
      })
      .catch((err) => {
        if (!ignore) setDataError(err.message);
      })
      .finally(() => {
        if (!ignore) setLoadingData(false);
      });

    return () => {
      ignore = true;
    };
  }, [accountId]);

  function handlePixelChange(id) {
    setPixelId(id);
    setPixelMapping(accountId, id);
  }

  function handleLaunch() {
    setLaunching(true);
    setLaunchError(null);
    setResult(null);

    fetch("/api/fb/launch-strategy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, strategyId: strategy.id, dailyBudget, pageId, pixelId, status }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setLaunchError(json.error);
        else setResult(json);
      })
      .catch((err) => setLaunchError(err.message))
      .finally(() => setLaunching(false));
  }

  const rememberedPixel = !loadingData && getPixelMapping(accountId);
  const canLaunch = pageId && pixelId && !launching;

  function adsManagerUrl(kind, id) {
    const numericId = accountId.replace(/^act_/, "");
    const path = kind === "campaign" ? "campaigns" : "adsets";
    const param = kind === "campaign" ? "selected_campaign_ids" : "selected_adset_ids";
    return `https://www.facebook.com/adsmanager/manage/${path}?act=${numericId}&${param}=${id}`;
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.65)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 800,
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.card}
        style={{ background: "#0f0e1e", width: "min(560px, 100%)", maxHeight: "85vh", overflow: "auto" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              Launch Strategy {strategy.id}
            </h2>
            <p className={styles.sub}>Creates real campaign(s) and ad set(s) on this ad account.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {loadingData && <Loader label="Loading Pages & pixels…" />}
        {dataError && <div className={styles.error}>Error: {dataError}</div>}

        {!loadingData && !dataError && !result && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Facebook Page
              </p>
              <select className={styles.select} style={{ width: "100%" }} value={pageId} onChange={(e) => setPageId(e.target.value)}>
                <option value="" disabled>
                  Select a Page…
                </option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {pages.length === 0 && (
                <p className={styles.sub} style={{ color: "#ff7070" }}>
                  No Pages found — a Page is required to launch.
                </p>
              )}
            </div>

            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Pixel{" "}
                {rememberedPixel && <span className={styles.muted}>(remembered for this account — change anytime below)</span>}
              </p>
              <select className={styles.select} style={{ width: "100%" }} value={pixelId} onChange={(e) => handlePixelChange(e.target.value)}>
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
                <p className={styles.sub} style={{ color: "#ff7070" }}>
                  No pixel found on this account — required for Add to Cart/Purchase optimization.
                </p>
              )}
            </div>

            <div>
              <p className={styles.sub} style={{ marginBottom: 6 }}>
                Launch status
              </p>
              <div className={styles.tabGroup}>
                <button
                  type="button"
                  className={status === "PAUSED" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => setStatus("PAUSED")}
                >
                  Paused — review before spending
                </button>
                <button
                  type="button"
                  className={status === "ACTIVE" ? `${styles.tab} ${styles.tabActive}` : styles.tab}
                  onClick={() => setStatus("ACTIVE")}
                >
                  Active immediately
                </button>
              </div>
            </div>

            <p className={styles.sub}>
              Targets India, with a 1% lookalike where this strategy uses one — not configurable yet. Any
              retargeting/lookalike audience this strategy needs is created automatically if one doesn&apos;t
              already exist (and reused on future launches); a freshly created Lookalike can take some time to
              populate before it reaches full delivery.
            </p>

            {launchError && <div className={styles.error}>Error: {launchError}</div>}

            <button type="button" className={styles.btnPrimary} disabled={!canLaunch} onClick={handleLaunch}>
              {launching ? "Launching…" : `Launch Strategy ${strategy.id}`}
            </button>
          </div>
        )}

        {result && <LaunchResult result={result} onClose={onClose} adsManagerUrl={adsManagerUrl} />}
      </div>
    </div>
  );
}

// Module-level (not nested inside LaunchPanel's render body) so it isn't
// recreated — and remounted — on every re-render, the same reasoning as
// pages/report.js's BreakdownSection. Shows each created campaign as its own
// card with a direct Ads Manager link, its ad sets nested underneath with
// their own links; audience and activation steps render as simple rows above
// and below. Every row shows Facebook's own error text on failure rather
// than just "failed".
function LaunchResult({ result, onClose, adsManagerUrl }) {
  const steps = result.steps || [];
  const audienceSteps = steps.filter((s) => s.type === "audience");
  const campaignSteps = steps.filter((s) => s.type === "campaign");
  const activationStep = steps.find((s) => s.type === "activation");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
      <p className={styles.sub}>
        <strong style={{ color: result.success ? "#4ade80" : "#fbbf24" }}>
          {result.success ? "Launched successfully." : "Launched with some errors — see below."}
        </strong>
      </p>

      {audienceSteps.map((s, i) => (
        <StepRow key={`audience-${i}`} step={s} />
      ))}

      {campaignSteps.map((c, i) => {
        const adsets = steps.filter((s) => s.type === "adset" && c.success && s.campaignId === c.id);
        return (
          <div key={c.id || `campaign-${i}`} className={styles.card} style={{ padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</span>
              {c.success ? (
                <a href={adsManagerUrl("campaign", c.id)} target="_blank" rel="noreferrer" className={styles.badgeGood}>
                  View in Ads Manager
                </a>
              ) : (
                <span className={styles.badgeDanger}>Failed</span>
              )}
            </div>
            {!c.success && (
              <p className={styles.sub} style={{ color: "#ff7070", marginTop: 6 }}>
                {c.error}
              </p>
            )}
            {adsets.length > 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginTop: 10,
                  paddingLeft: 12,
                  borderLeft: "2px solid var(--border)",
                }}
              >
                {adsets.map((a, j) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: "var(--t2)" }}>{a.name}</span>
                    {a.success ? (
                      <a href={adsManagerUrl("adset", a.id)} target="_blank" rel="noreferrer" className={styles.badgeGood}>
                        View
                      </a>
                    ) : (
                      <span className={styles.badgeDanger}>{a.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {activationStep && <StepRow step={activationStep} />}

      <button type="button" className={styles.btnSecondary} onClick={onClose} style={{ alignSelf: "flex-start" }}>
        Close
      </button>
    </div>
  );
}

function StepRow({ step }) {
  return (
    <div className={styles.listItem} style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <span style={{ fontWeight: 700 }}>{step.label}</span>
      {step.success ? (
        <span className={styles.badgeGood}>{step.id ? `Created — ${step.id}` : "Done"}</span>
      ) : (
        <span className={styles.badgeDanger}>{step.error}</span>
      )}
    </div>
  );
}
