import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import LabeledPill from "@/components/LabeledPill";
import AccountSelect from "@/components/AccountSelect";
import { useAccounts } from "@/components/AccountProvider";
import { DownloadIcon } from "@/components/icons";
import { parseJsonResponse } from "@/lib/fetchJson";
import { track } from "@/lib/analytics";
import { currencySymbolOf } from "@/lib/rules/leanFlag";
import { assumptionsFromTotals, computePlan, splitBudget, sumMonths, totalPlan } from "@/lib/mediaPlan";
import { buildXlsx, downloadXlsx } from "@/lib/xlsxWriter";
import styles from "@/styles/Home.module.css";

// Media Plan: type a budget, pick the ad accounts, and get the plan the way the "Media Plan" sheet of the performance
// report builds it. Every assumption (CTR, CPC, click -> landing page view -> add to cart -> checkout -> purchase, AOV) is
// that account's average over the last three full months, and can be changed; everything else is worked out from them
// (lib/mediaPlan.js has the formulae).

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
function planMonthOptions() {
  const now = new Date();
  return [0, 1, 2].map((i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
    return `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  });
}

const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const dash = "–";
const fInt = (v) => (v == null ? dash : nf.format(Math.round(v)));
const fMoney = (v, sym) => (v == null ? dash : `${sym}${nf.format(Math.round(v))}`);
const fPct = (v, d = 2) => (v == null ? dash : `${(v * 100).toFixed(d)}%`);
const fX = (v) => (v == null ? dash : `${v.toFixed(2)}x`);

// The seven assumptions a person can change. `pct`: shown and typed as a percentage, stored as a fraction.
const INPUTS = [
  { key: "ctr", label: "CTR", pct: true, digits: 2 },
  { key: "cpc", label: "CPC", digits: 2, money: true },
  { key: "clickToLpv", label: "Click → LPV", pct: true, digits: 1 },
  { key: "clickToAtc", label: "Click → ATC", pct: true, digits: 2 },
  { key: "atcToIc", label: "ATC → Checkout", pct: true, digits: 2 },
  { key: "icToPur", label: "Checkout → Purchase", pct: true, digits: 2 },
  { key: "aov", label: "AOV", digits: 0, money: true },
];

const th = { textAlign: "right", whiteSpace: "nowrap" };
const td = { textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
const stickyCol = { position: "sticky", left: 0, zIndex: 2, background: "var(--bg)", textAlign: "left", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function AssumptionInput({ spec, value, edited, onChange }) {
  const shown = edited != null ? edited : value == null ? "" : String(+(spec.pct ? value * 100 : value).toFixed(spec.digits));
  return (
    <input
      type="number"
      min="0"
      step="any"
      value={shown}
      onChange={(e) => onChange(e.target.value)}
      className={styles.select}
      style={{ width: 82, padding: "4px 6px", textAlign: "right", borderColor: edited != null ? "var(--purple)" : undefined }}
      aria-label={spec.label}
    />
  );
}

export default function MediaPlan() {
  const { adAccounts, selectedAccountId, accountsLoading } = useAccounts();
  const [pickedIds, setIds] = useState(null); // null until the person changes it: then the account selected in the app is used
  const ids = useMemo(() => pickedIds ?? (selectedAccountId ? [selectedAccountId] : []), [pickedIds, selectedAccountId]);
  const [budget, setBudget] = useState("500000");
  const [month, setMonth] = useState(() => planMonthOptions()[1]);
  const [split, setSplit] = useState("spend");
  const [history, setHistory] = useState({}); // account id -> { months } | { error }
  const [failure, setFailure] = useState(null); // { key, message } for the accounts that were being loaded
  const [range, setRange] = useState(null);
  const [edits, setEdits] = useState({}); // account id -> { key: typed text }

  // Fetch the last three months for accounts not loaded yet.
  useEffect(() => {
    const missing = ids.filter((id) => !history[id]);
    if (missing.length === 0) return undefined;
    let alive = true;
    const key = ids.join(",");
    fetch(`/api/fb/media-plan-history?accountIds=${encodeURIComponent(missing.join(","))}`)
      .then(async (res) => {
        const json = await parseJsonResponse(res);
        if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
        return json;
      })
      .then((json) => {
        if (!alive) return;
        setRange(json.range);
        setHistory((h) => ({ ...h, ...Object.fromEntries(json.accounts.map((a) => [a.accountId, a.error ? { error: a.error } : { months: a.months }])) }));
      })
      .catch((err) => alive && setFailure({ key, message: err.message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const key = ids.join(",");
  const error = failure?.key === key ? failure.message : null;
  const loading = !error && ids.some((id) => !history[id]);

  const picked = useMemo(
    () =>
      ids
        .map((id) => adAccounts.find((a) => a.id === id))
        .filter(Boolean)
        .map((a) => {
          const h = history[a.id];
          const totals = h?.months ? sumMonths(h.months) : null;
          return { id: a.id, name: a.name, currency: a.currency, months: h?.months || null, loadError: h?.error || null, totals, base: totals ? assumptionsFromTotals(totals) : null, pastSpend: totals?.spend || 0 };
        }),
    [ids, adAccounts, history]
  );

  const currencies = [...new Set(picked.map((p) => p.currency).filter(Boolean))];
  const mixedCurrency = currencies.length > 1;
  const sym = currencySymbolOf(currencies[0]);
  const total = Math.max(0, Number(budget) || 0);
  const ready = picked.length > 0 && picked.every((p) => p.totals || p.loadError);

  const rows = useMemo(() => {
    const costs = splitBudget(total, picked, split);
    return picked.map((p, i) => {
      const a = { ...(p.base || Object.fromEntries(INPUTS.map((s) => [s.key, null]))) };
      for (const spec of INPUTS) {
        const typed = edits[p.id]?.[spec.key];
        if (typed != null) {
          const n = parseFloat(typed);
          a[spec.key] = Number.isFinite(n) && n > 0 ? (spec.pct ? n / 100 : n) : null;
        }
      }
      return { p, plan: computePlan(costs[i], a) };
    });
  }, [picked, total, split, edits]);
  const totals = useMemo(() => (rows.length > 1 ? totalPlan(rows.map((r) => r.plan)) : null), [rows]);
  const grand = totals || rows[0]?.plan || null;

  useEffect(() => {
    if (ready && !mixedCurrency && total > 0) track("media_plan_built", { accounts: picked.length, budget: Math.round(total), split });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mixedCurrency, picked.length, split]);

  const setEdit = (id, key, text) => setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: text } }));
  const resetRow = (id) => setEdits((e) => ({ ...e, [id]: {} }));
  const anyEdited = (id) => Object.keys(edits[id] || {}).length > 0;

  function exportXlsx() {
    const head = ["Account", "Month", "Planned Cost", "Impressions", "Clicks", "CTR", "CPC", "CPM", "LP View", "Click to LPV", "ATC", "Click to ATC", "Checkout Initiated", "ATC to IC", "IC to Pur", "Purchases", "Revenue", "ROAS", "CPP", "AOV", "CVR"];
    const line = (name, r) => [
      name, month, { v: r.cost, fmt: "#,##0" }, { v: r.impressions, fmt: "#,##0" }, { v: r.clicks, fmt: "#,##0" }, { v: r.ctr, fmt: "0.00%" }, { v: r.cpc, fmt: "#,##0.00" },
      { v: r.cpm, fmt: "#,##0.00" }, { v: r.lpv, fmt: "#,##0" }, { v: r.clickToLpv, fmt: "0.0%" }, { v: r.atc, fmt: "#,##0" }, { v: r.clickToAtc, fmt: "0.00%" },
      { v: r.ic, fmt: "#,##0" }, { v: r.atcToIc, fmt: "0.00%" }, { v: r.icToPur, fmt: "0.00%" }, { v: r.purchases, fmt: "#,##0" }, { v: r.revenue, fmt: "#,##0" },
      { v: r.roas, fmt: "0.00" }, { v: r.cpp, fmt: "#,##0.00" }, { v: r.aov, fmt: "#,##0" }, { v: r.cvr, fmt: "0.00%" },
    ].map((c) => (c && typeof c === "object" ? (c.v == null ? "" : c) : c));
    const sheetRows = [head.map((h) => ({ v: h, bold: true })), ...rows.map(({ p, plan }) => line(p.name, plan))];
    if (totals) sheetRows.push(line("Total", totals).map((c) => (c && typeof c === "object" ? { ...c, bold: true } : c)));
    track("media_plan_exported", { accounts: picked.length });
    downloadXlsx(`Media plan - ${month}.xlsx`, buildXlsx({ sheetName: "Media Plan", widths: [28, 16, ...Array(head.length - 2).fill(14)], rows: sheetRows }));
  }

  const missingData = rows.filter(({ p }) => p.totals && p.totals.spend <= 0);

  return (
    <Layout>
      <Head>
        <title>Media Plan · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1400, margin: "0 auto" }}>
          <div style={{ marginBottom: 16 }}>
            <h1 className={styles.h1} style={{ margin: 0 }}>
              Media Plan
            </h1>
            <p className={styles.sub} style={{ marginTop: 6 }}>
              Enter a budget and pick your ad accounts. The plan is built from each account&apos;s averages over the last three full months, with the same formulae as the Media Plan sheet.
            </p>
          </div>

          <section className={styles.card} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
              <LabeledPill label={`Budget${currencies.length === 1 ? ` (${currencies[0]})` : ""}`}>
                <input type="number" min="0" step="1000" value={budget} onChange={(e) => setBudget(e.target.value)} className={styles.select} style={{ width: 160 }} aria-label="Budget" />
              </LabeledPill>
              <LabeledPill label="Plan month">
                <select className={styles.select} value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Plan month">
                  {planMonthOptions().map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </LabeledPill>
              <div style={{ flex: "1 1 320px", minWidth: 260 }}>
                <LabeledPill label="Ad accounts">
                  <AccountSelect accounts={adAccounts} values={ids} onChange={setIds} multiple maxSelected={20} placeholder="Add ad accounts…" loading={accountsLoading} />
                </LabeledPill>
              </div>
              {picked.length > 1 ? (
                <LabeledPill label="Split the budget">
                  <select className={styles.select} value={split} onChange={(e) => setSplit(e.target.value)} aria-label="Split the budget">
                    <option value="spend">By last 3 months&apos; spend</option>
                    <option value="equal">Equally</option>
                  </select>
                </LabeledPill>
              ) : null}
              <button type="button" className={styles.btnSecondary} onClick={exportXlsx} disabled={!ready || mixedCurrency || !rows.length} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                <DownloadIcon size={14} /> Download Excel
              </button>
            </div>
          </section>

          {error && <div className={styles.error}>{error}</div>}
          {mixedCurrency && <div className={styles.error}>These accounts use different currencies ({currencies.join(", ")}), so one budget can&apos;t be split across them. Pick accounts that share a currency.</div>}
          {picked.length === 0 && !loading ? (
            <section className={styles.card}>
              <p className={styles.sub}>Pick at least one ad account to build a plan.</p>
            </section>
          ) : null}
          {loading && <Loader label="Reading the last 3 months…" />}

          {ready && !mixedCurrency && rows.length > 0 && (
            <>
              <section className={styles.card} style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline", marginBottom: 10 }}>
                  <h2 className={styles.h2} style={{ margin: 0 }}>
                    Meta media plan · {month}
                  </h2>
                  <span className={styles.muted}>
                    Assumptions: average of {range ? `${range.since} → ${range.until}` : "the last 3 full months"}. Change any highlighted cell to try another scenario.
                  </span>
                </div>
                <div className={styles.tableScroll} style={{ maxHeight: "none" }}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ ...stickyCol, zIndex: 4 }}>Account</th>
                        <th style={th}>Planned cost</th>
                        <th style={th}>Impressions</th>
                        <th style={th}>Clicks</th>
                        <th style={th}>CTR</th>
                        <th style={th}>CPC</th>
                        <th style={th}>CPM</th>
                        <th style={th}>LP views</th>
                        <th style={th}>Click → LPV</th>
                        <th style={th}>ATC</th>
                        <th style={th}>Click → ATC</th>
                        <th style={th}>Checkouts</th>
                        <th style={th}>ATC → Checkout</th>
                        <th style={th}>Checkout → Purchase</th>
                        <th style={th}>Purchases</th>
                        <th style={th}>Revenue</th>
                        <th style={th}>ROAS</th>
                        <th style={th}>CPP</th>
                        <th style={th}>AOV</th>
                        <th style={th}>CVR</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ p, plan }) => {
                        const input = (key) => {
                          const spec = INPUTS.find((s) => s.key === key);
                          return <AssumptionInput spec={spec} value={p.base?.[key]} edited={edits[p.id]?.[key]} onChange={(t) => setEdit(p.id, key, t)} />;
                        };
                        return (
                          <tr key={p.id}>
                            <td style={stickyCol} title={p.name}>
                              {p.name}
                              {p.loadError ? <div className={styles.muted}>Couldn&apos;t load: {p.loadError}</div> : null}
                            </td>
                            <td style={td}>{fMoney(plan.cost, sym)}</td>
                            <td style={td}>{fInt(plan.impressions)}</td>
                            <td style={td}>{fInt(plan.clicks)}</td>
                            <td style={td}>{input("ctr")}</td>
                            <td style={td}>{input("cpc")}</td>
                            <td style={td}>{plan.cpm == null ? dash : `${sym}${plan.cpm.toFixed(2)}`}</td>
                            <td style={td}>{fInt(plan.lpv)}</td>
                            <td style={td}>{input("clickToLpv")}</td>
                            <td style={td}>{fInt(plan.atc)}</td>
                            <td style={td}>{input("clickToAtc")}</td>
                            <td style={td}>{fInt(plan.ic)}</td>
                            <td style={td}>{input("atcToIc")}</td>
                            <td style={td}>{input("icToPur")}</td>
                            <td style={td}>{fInt(plan.purchases)}</td>
                            <td style={td}>{fMoney(plan.revenue, sym)}</td>
                            <td style={td}>{fX(plan.roas)}</td>
                            <td style={td}>{plan.cpp == null ? dash : fMoney(plan.cpp, sym)}</td>
                            <td style={td}>{input("aov")}</td>
                            <td style={td}>{fPct(plan.cvr)}</td>
                            <td style={td}>
                              {anyEdited(p.id) ? (
                                <button type="button" className={styles.btnSecondary} style={{ padding: "3px 8px", fontSize: 11 }} onClick={() => resetRow(p.id)}>
                                  Reset
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                      {totals ? (
                        <tr style={{ fontWeight: 700 }}>
                          <td style={stickyCol}>Total</td>
                          <td style={td}>{fMoney(totals.cost, sym)}</td>
                          <td style={td}>{fInt(totals.impressions)}</td>
                          <td style={td}>{fInt(totals.clicks)}</td>
                          <td style={td}>{fPct(totals.ctr)}</td>
                          <td style={td}>{totals.cpc == null ? dash : `${sym}${totals.cpc.toFixed(2)}`}</td>
                          <td style={td}>{totals.cpm == null ? dash : `${sym}${totals.cpm.toFixed(2)}`}</td>
                          <td style={td}>{fInt(totals.lpv)}</td>
                          <td style={td}>{fPct(totals.clickToLpv, 1)}</td>
                          <td style={td}>{fInt(totals.atc)}</td>
                          <td style={td}>{fPct(totals.clickToAtc)}</td>
                          <td style={td}>{fInt(totals.ic)}</td>
                          <td style={td}>{fPct(totals.atcToIc)}</td>
                          <td style={td}>{fPct(totals.icToPur)}</td>
                          <td style={td}>{fInt(totals.purchases)}</td>
                          <td style={td}>{fMoney(totals.revenue, sym)}</td>
                          <td style={td}>{fX(totals.roas)}</td>
                          <td style={td}>{totals.cpp == null ? dash : fMoney(totals.cpp, sym)}</td>
                          <td style={td}>{fMoney(totals.aov, sym)}</td>
                          <td style={td}>{fPct(totals.cvr)}</td>
                          <td />
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                {missingData.length ? (
                  <p className={styles.muted} style={{ marginTop: 10 }}>
                    {missingData.map((r) => r.p.name).join(", ")} had no spend in the last 3 months, so there is nothing to average. Type your own assumptions in its row to plan for it.
                  </p>
                ) : null}
                {grand ? (
                  <p className={styles.sub} style={{ marginTop: 12 }}>
                    <b>{fMoney(grand.cost, sym)}</b> is planned to bring about <b>{fInt(grand.purchases)}</b> purchases and <b>{fMoney(grand.revenue, sym)}</b> in revenue ({fX(grand.roas)} ROAS, {fMoney(grand.cpp, sym)} per purchase).
                  </p>
                ) : null}
                <p className={styles.muted} style={{ marginTop: 6 }}>
                  The plan assumes results grow in step with spend. A much bigger budget than the last 3 months&apos; usually costs more per click, so treat a big jump as a best case and adjust CPC or CTR above.
                </p>
              </section>

              <details className={styles.card}>
                <summary style={{ cursor: "pointer", fontWeight: 700 }}>What the assumptions are based on (last 3 full months)</summary>
                <div className={styles.tableScroll} style={{ maxHeight: "none", marginTop: 12 }}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Account</th>
                        <th style={{ textAlign: "left" }}>Month</th>
                        <th style={th}>Spend</th>
                        <th style={th}>Impressions</th>
                        <th style={th}>Link clicks</th>
                        <th style={th}>LP views</th>
                        <th style={th}>ATC</th>
                        <th style={th}>Checkouts</th>
                        <th style={th}>Purchases</th>
                        <th style={th}>Revenue</th>
                        <th style={th}>ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {picked.filter((p) => p.months).flatMap((p) => [
                        ...p.months.map((m, i) => (
                          <tr key={`${p.id}-${m.month}`}>
                            <td>{i === 0 ? p.name : ""}</td>
                            <td>{monthLabel(m.month)}</td>
                            <td style={td}>{fMoney(m.spend, sym)}</td>
                            <td style={td}>{fInt(m.impressions)}</td>
                            <td style={td}>{fInt(m.linkClicks)}</td>
                            <td style={td}>{fInt(m.lpv)}</td>
                            <td style={td}>{fInt(m.atc)}</td>
                            <td style={td}>{fInt(m.ic)}</td>
                            <td style={td}>{fInt(m.purchases)}</td>
                            <td style={td}>{fMoney(m.revenue, sym)}</td>
                            <td style={td}>{m.spend > 0 ? fX(m.revenue / m.spend) : dash}</td>
                          </tr>
                        )),
                        <tr key={`${p.id}-all`} style={{ fontWeight: 700 }}>
                          <td />
                          <td>3 months</td>
                          <td style={td}>{fMoney(p.totals.spend, sym)}</td>
                          <td style={td}>{fInt(p.totals.impressions)}</td>
                          <td style={td}>{fInt(p.totals.linkClicks)}</td>
                          <td style={td}>{fInt(p.totals.lpv)}</td>
                          <td style={td}>{fInt(p.totals.atc)}</td>
                          <td style={td}>{fInt(p.totals.ic)}</td>
                          <td style={td}>{fInt(p.totals.purchases)}</td>
                          <td style={td}>{fMoney(p.totals.revenue, sym)}</td>
                          <td style={td}>{p.totals.spend > 0 ? fX(p.totals.revenue / p.totals.spend) : dash}</td>
                        </tr>,
                      ])}
                    </tbody>
                  </table>
                </div>
                <p className={styles.muted} style={{ marginTop: 10 }}>
                  Each average adds the three months together first (so a busy month counts for more), then divides: CTR = link clicks ÷ impressions, CPC = spend ÷ link clicks, and each funnel step is the count at that step ÷ the step before. Clicks are link clicks and the funnel starts at landing page views, as in the sheet.
                </p>
              </details>
            </>
          )}
        </main>
      </div>
    </Layout>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) return { redirect: { destination: "/", permanent: false } };
  return { props: { session: publicSession(session) } };
}
