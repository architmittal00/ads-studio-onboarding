import { useState } from "react";
import Loader from "@/components/Loader";
import { formatMetricValue } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// Review & Launch for a catalog ad — same NDJSON-streaming / per-step result
// rendering as components/LaunchReview.js (the existing Launch tab's own
// review step), copied rather than imported since the request/result shape
// differs (this always creates an ad + creative; that one only does for a
// duplicate), posting to the new pages/api/fb/catalog-ads/launch.js instead.
export default function CatalogLaunchReview({ accountId, currency, campaign, existingCampaignId, existingCampaignName, budgetStrategy, budgetType, budgetAmount, adset, ad, onBack }) {
  const [status, setStatus] = useState("PAUSED");
  const [launching, setLaunching] = useState(false);
  const [currentStep, setCurrentStep] = useState(null);
  const [launchError, setLaunchError] = useState(null);
  const [result, setResult] = useState(null);

  async function handleLaunch() {
    setLaunching(true);
    setLaunchError(null);
    setResult(null);
    setCurrentStep("Starting…");

    try {
      const res = await fetch("/api/fb/catalog-ads/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          campaign: campaign || null,
          existingCampaignId: existingCampaignId || null,
          budgetStrategy,
          budgetType,
          budgetAmount,
          adset,
          ad,
          status,
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

  function adsManagerUrl(kind, id) {
    const numericId = accountId.replace(/^act_/, "");
    const path = kind === "campaign" ? "campaigns" : kind === "adset" ? "adsets" : "ads";
    const param = kind === "campaign" ? "selected_campaign_ids" : kind === "adset" ? "selected_adset_ids" : "selected_ad_ids";
    return `https://www.facebook.com/adsmanager/manage/${path}?act=${numericId}&${param}=${id}`;
  }

  if (result) return <LaunchResult result={result} onBack={onBack} adsManagerUrl={adsManagerUrl} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className={styles.card}>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Summary
        </p>
        <ul className={styles.list}>
          <li className={styles.listItem}>{campaign ? `New campaign: ${campaign.name || "(unnamed)"}` : `Existing campaign: ${existingCampaignName}`}</li>
          <li className={styles.listItem}>
            {budgetStrategy === "CBO" ? "Campaign" : "Ad set"} {budgetType === "LIFETIME" ? "lifetime" : "daily"} budget:{" "}
            {budgetAmount ? formatMetricValue(parseFloat(budgetAmount), "currency", currency) : <span style={{ color: "var(--red)" }}>not set</span>}
          </li>
          <li className={styles.listItem}>New ad set: {adset.name || "(unnamed)"}</li>
          <li className={styles.listItem}>New ad: {ad.name || "(unnamed)"}</li>
        </ul>
      </div>

      <div>
        <p className={styles.sub} style={{ marginBottom: 6 }}>
          Launch status
        </p>
        <div className={styles.tabGroup}>
          <button type="button" className={status === "PAUSED" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("PAUSED")}>
            Paused — review before spending
          </button>
          <button type="button" className={status === "ACTIVE" ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setStatus("ACTIVE")}>
            Active immediately
          </button>
        </div>
      </div>

      {launchError && <div className={styles.error}>Error: {launchError}</div>}

      <div style={{ display: "flex", gap: 10 }}>
        <button type="button" className={styles.btnSecondary} onClick={onBack} disabled={launching}>
          Back
        </button>
        {launching ? (
          <Loader label={currentStep || "Launching…"} />
        ) : (
          <button type="button" className={styles.btnPrimary} onClick={handleLaunch} disabled={!budgetAmount}>
            Launch
          </button>
        )}
      </div>
    </div>
  );
}

function LaunchResult({ result, onBack, adsManagerUrl }) {
  const steps = result.steps || [];
  const campaignStep = steps.find((s) => s.type === "campaign");
  const adsetStep = steps.find((s) => s.type === "adset");
  const adStep = steps.find((s) => s.type === "ad");
  const activationStep = steps.find((s) => s.type === "activation");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p className={styles.sub}>
        <strong style={{ color: result.success ? "var(--green)" : "var(--amber)" }}>
          {result.success ? "Launched successfully." : "Launched with some errors — see below."}
        </strong>
      </p>

      {campaignStep && <StepRow step={campaignStep} kind="campaign" adsManagerUrl={adsManagerUrl} />}
      {adsetStep && <StepRow step={adsetStep} kind="adset" adsManagerUrl={adsManagerUrl} />}
      {adStep && <StepRow step={adStep} kind="ad" adsManagerUrl={adsManagerUrl} />}
      {activationStep && <StepRow step={activationStep} />}

      <button type="button" className={styles.btnSecondary} onClick={onBack} style={{ alignSelf: "flex-start" }}>
        Start a new ad
      </button>
    </div>
  );
}

function StepRow({ step, kind, adsManagerUrl }) {
  return (
    <div className={styles.listItem} style={{ flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
      <span style={{ fontWeight: 700 }}>
        {step.label}
        {step.name ? `: ${step.name}` : ""}
      </span>
      {step.success ? (
        kind && step.id ? (
          <a href={adsManagerUrl(kind, step.id)} target="_blank" rel="noreferrer" className={styles.badgeGood}>
            View in Ads Manager
          </a>
        ) : (
          <span className={styles.badgeGood}>Done</span>
        )
      ) : (
        <span className={styles.badgeDanger}>{step.error}</span>
      )}
    </div>
  );
}
