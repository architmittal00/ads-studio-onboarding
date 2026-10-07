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
// per the current scope, see lib/campaignLaunch.js. `interestChoices`
// (array of arrays of {id, name, ...}, index-aligned to this strategy's
// interest-type ad sets) is chosen on the recommendation card itself
// (pages/strategy.js, via components/InterestTargetingSection) — not here —
// so this panel only reads it back as a read-only summary and includes it in
// the launch request; closing this panel to go change it on the card doesn't
// lose anything, since the choices live in the parent page's state.
export default function LaunchPanel({ strategy, accountId, dailyBudget, interestChoices = [], onClose }) {
  const [loadingData, setLoadingData] = useState(true);
  const [dataError, setDataError] = useState(null);
  const [pages, setPages] = useState([]);
  const [pixels, setPixels] = useState([]);

  const [pageId, setPageId] = useState("");
  const [pixelId, setPixelId] = useState("");
  const [status, setStatus] = useState("PAUSED");

  const [launching, setLaunching] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
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

  // Streams newline-delimited JSON from /api/fb/launch-strategy instead of
  // waiting for one final response — a `{type:"progress"}` line before each
  // slow step updates currentStep in real time ("Creating campaign 2 of
  // 3…"), then a `{type:"done"}` line carries the final per-object results.
  async function handleLaunch() {
    setLaunching(true);
    setLaunchError(null);
    setResult(null);
    setCurrentStep("Starting…");

    try {
      const res = await fetch("/api/fb/launch-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          strategyId: strategy.id,
          dailyBudget,
          pageId,
          pixelId,
          status,
          // Trim to just {id, name} per interest — audience-size/path fields
          // are UI-only and not something the launch endpoint needs.
          ...(interestChoices.length > 0
            ? { interestChoices: interestChoices.map((group) => group.map((c) => ({ id: c.id, name: c.name }))) }
            : {}),
        }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `Request failed (${res.status})`);
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
          const event = JSON.parse(line);
          if (event.type === "progress") setCurrentStep(event.message);
          else if (event.type === "done") setResult(event);
        }
      }
    } catch (err) {
      setLaunchError(err.message);
    } finally {
      setLaunching(false);
      setCurrentStep(null);
    }
  }

  const rememberedPixel = !loadingData && getPixelMapping(accountId);
  const allInterestsChosen = interestChoices.every((group) => group.length > 0);
  const canLaunch = pageId && pixelId && !launching && allInterestsChosen;

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
            {interestChoices.length > 0 && (
              <div>
                <p className={styles.sub} style={{ marginBottom: 6 }}>
                  Interest targeting
                </p>
                <ul className={styles.list}>
                  {interestChoices.map((group, i) => (
                    <li key={i} className={styles.listItem} style={{ fontWeight: 500 }}>
                      Ad set {i + 1}: {group.length > 0 ? group.map((c) => c.name).join(" + ") : "No interest chosen yet"}
                    </li>
                  ))}
                </ul>
                {!allInterestsChosen && (
                  <p className={styles.sub} style={{ marginTop: 6, fontSize: 11.5 }}>
                    Close this panel and choose an interest for every ad set on the strategy card above to launch.
                  </p>
                )}
              </div>
            )}

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

            {launching ? (
              <Loader label={currentStep || "Launching…"} />
            ) : (
              <button type="button" className={styles.btnPrimary} disabled={!canLaunch} onClick={handleLaunch}>
                Launch Strategy {strategy.id}
              </button>
            )}
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
              {c.success ? (
                <CopyableName text={`${c.name} (${c.id})`}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</span>
                </CopyableName>
              ) : (
                <span style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</span>
              )}
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
                    {a.success ? (
                      <CopyableName text={`${a.name} (${a.id})`}>
                        <span style={{ fontSize: 12.5, color: "var(--t2)" }}>{a.name}</span>
                      </CopyableName>
                    ) : (
                      <span style={{ fontSize: 12.5, color: "var(--t2)" }}>{a.name}</span>
                    )}
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
  // Audience steps can be a genuine create OR a reuse of one this tool made
  // earlier ("auto-create if missing" — see lib/audienceManager.js); the
  // badge used to say "Created" either way, which misreported reuse as a
  // fresh create. `step.created` (set explicitly by the API for audience
  // steps) is what actually distinguishes them.
  const badgeText =
    step.type === "audience"
      ? step.created
        ? `Created — ${step.id}`
        : `Found existing — ${step.id}`
      : step.id
      ? `Created — ${step.id}`
      : "Done";

  return (
    <div className={styles.listItem} style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <span style={{ fontWeight: 700 }}>{step.label}</span>
      {step.success ? (
        <CopyableName text={`${step.label} — ${step.id}`} className={styles.badgeGood}>
          {badgeText}
        </CopyableName>
      ) : (
        <span className={styles.badgeDanger}>{step.error}</span>
      )}
    </div>
  );
}

// Click-to-copy wrapper used for every created object's name/badge in the
// launch results — copies `text` (name + id) to the clipboard and flashes
// "Copied!" in place of the children for a moment as confirmation.
function CopyableName({ text, className, children }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e) {
    e.stopPropagation();
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <span onClick={handleCopy} title="Click to copy" className={className} style={{ cursor: "pointer" }}>
      {copied ? "Copied!" : children}
    </span>
  );
}
