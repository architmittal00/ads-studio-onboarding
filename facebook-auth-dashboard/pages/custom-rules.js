import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import PinLock from "@/components/PinLock";
import Loader from "@/components/Loader";
import { useAccounts } from "@/components/AccountProvider";
import { parseJsonResponse } from "@/lib/fetchJson";
import { describeRule, validateSpec, requiredData, extraFetches, actionChoices, RULE_METRICS } from "@/lib/rules/customRule";
import { currencySymbolOf } from "@/lib/rules/leanFlag";
import { clearAllRuleCaches } from "@/lib/rules/useRuleAttention";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

const MAX_TEXT = 600;
const ACTION_WORD = { PAUSE_AD: "Pause", INCREASE_BUDGET: "Raise budget", DECREASE_BUDGET: "Lower budget", NOTE: "Flag" };
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const LEVEL_FOR_READS = { ad: "per ad", adset: "per ad set" };

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await parseJsonResponse(res).catch((e) => ({ error: e.message }));
  if (!res.ok && !body.status) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}
const post = (path, body, method = "POST") => api(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export default function CustomRules() {
  return (
    <Layout>
      <Head>
        <title>Custom Rules · Facebook Auth Dashboard</title>
      </Head>
      <PinLock label="Custom Rules">
        <CustomRulesContent />
      </PinLock>
    </Layout>
  );
}

// "7-day, per ad" lines for what a rule reads (the data it needs).
const readsText = (reads) => reads.map((r) => `${r.window === 1 ? "yesterday" : `${r.window}-day`} ${LEVEL_FOR_READS[r.rowLevel]}`).join(", ");
const extraText = (extra) => extra.map((r) => `${r.window === 1 ? "yesterday" : `${r.window}-day`} figures ${LEVEL_FOR_READS[r.rowLevel]}`).join(", ");

// Where a rule applies. Nothing is pre-selected on a new rule: the person must choose. "all" is looked at every time an ad
// account is checked, so an ad account connected later is covered automatically.
function ScopePicker({ accounts, scope, onScope, selected, onToggle }) {
  const [q, setQ] = useState("");
  const shown = accounts.filter((a) => !q.trim() || `${a.name} ${a.id}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
        <input type="radio" name="rule-scope" checked={scope === "pick"} onChange={() => onScope("pick")} style={{ marginTop: 3 }} />
        <span>
          <strong>Only the ad accounts I pick</strong>
          <span className={styles.muted} style={{ display: "block" }}>A new ad account is not included unless you add it here later.</span>
        </span>
      </label>
      {scope === "pick" && (
        <div style={{ marginLeft: 24 }}>
          {accounts.length > 8 && <input className={styles.select} style={{ width: "100%", marginBottom: 6 }} placeholder="Search ad accounts…" value={q} onChange={(e) => setQ(e.target.value)} />}
          <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, padding: 6 }}>
            {shown.map((a) => (
              <label key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, padding: "4px 2px" }}>
                <input type="checkbox" checked={selected.has(a.id)} onChange={() => onToggle(a.id)} />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                <span className={styles.muted}>{a.id}</span>
              </label>
            ))}
            {shown.length === 0 && <p className={styles.sub} style={{ margin: 4 }}>No ad accounts match.</p>}
          </div>
          <p className={styles.muted} style={{ margin: "4px 0 0" }}>{selected.size} selected</p>
        </div>
      )}
      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
        <input type="radio" name="rule-scope" checked={scope === "all"} onChange={() => onScope("all")} style={{ marginTop: 3 }} />
        <span>
          <strong>All my ad accounts, including any I connect later</strong>
          <span className={styles.muted} style={{ display: "block" }}>The rule runs on every ad account you can check ({accounts.length} now), and automatically on new ones.</span>
        </span>
      </label>
    </div>
  );
}

function TestResults({ test, symbol }) {
  if (test.loading) return <Loader label="Reading the account and trying the rule… this can take up to a minute on a big account." />;
  if (test.error) return <div className={styles.error}>{test.error}</div>;
  return (
    <div>
      <p style={{ fontWeight: 700, margin: "0 0 6px" }}>
        {test.total === 0 ? "Nothing would be flagged right now." : `Would flag ${test.total} item${test.total === 1 ? "" : "s"} right now${test.total > test.matches.length ? ` (showing ${test.matches.length})` : ""}.`}
      </p>
      <p className={styles.sub} style={{ marginTop: 0 }}>
        Based on the last full days. Only purchase-optimised items outside Meta&apos;s learning phase with delivery in the last 7 days are checked{test.heldChecked ? ", and budget suggestions are skipped for 48 hours after a budget edit" : ""}.
      </p>
      {test.matches.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", fontSize: 12.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--t2)" }}>
                <th style={{ padding: "4px 8px 4px 0" }}>Item</th>
                <th style={{ padding: "4px 8px" }}>Suggestion</th>
                <th style={{ padding: "4px 8px", textAlign: "right" }}>7-day spend</th>
                <th style={{ padding: "4px 8px" }}>Why</th>
              </tr>
            </thead>
            <tbody>
              {test.matches.map((m) => (
                <tr key={m.key} style={{ borderTop: "1px solid var(--border)", verticalAlign: "top" }}>
                  <td style={{ padding: "6px 8px 6px 0", maxWidth: 280, overflowWrap: "anywhere" }}>
                    <strong>{m.name}</strong>
                    <div className={styles.muted}>{TYPE_LABEL[m.entityType]}</div>
                  </td>
                  <td style={{ padding: "6px 8px" }}>{ACTION_WORD[m.action] || m.action}</td>
                  <td style={{ padding: "6px 8px", textAlign: "right" }}>{symbol}{Math.round(m.spend7).toLocaleString("en-IN")}</td>
                  <td style={{ padding: "6px 8px" }}>{m.conditions.flatMap((c) => (c.either ? c.either.filter((o) => o.ok) : [c])).map((c) => `${c.label} (now ${c.actual})`).join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RuleRow({ rule, accounts, symbol, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scope, setScope] = useState(rule.allAccounts ? "all" : "pick");
  const [sel, setSel] = useState(() => new Set(rule.accountIds));
  const nameOf = (id) => accounts.find((a) => a.id === id)?.name || id;

  async function patch(body, event) {
    setBusy(true);
    setError(null);
    try {
      const out = await post("/api/fb/custom-rules", { id: rule.id, ...body }, "PATCH");
      if (out.error) throw new Error(out.error);
      clearAllRuleCaches();
      if (event) track(event, { enabled: body.enabled });
      onChanged(out.rule);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const out = await post("/api/fb/custom-rules", { id: rule.id }, "DELETE");
      if (out.error) throw new Error(out.error);
      clearAllRuleCaches();
      track("custom_rule_deleted", {});
      onChanged(null);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className={styles.card} style={{ padding: 14, opacity: rule.enabled ? 1 : 0.7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ flex: 1, minWidth: 0 }}>{rule.name}</strong>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
          <input type="checkbox" checked={rule.enabled} disabled={busy} onChange={(e) => patch({ enabled: e.target.checked }, "custom_rule_toggled")} />
          {rule.enabled ? "On" : "Off"}
        </label>
      </div>
      <p style={{ margin: "8px 0 4px", fontSize: 13.5 }}>{describeRule(rule.spec, symbol)}</p>
      <p className={styles.muted} style={{ margin: 0, overflowWrap: "anywhere" }}>
        You wrote: &ldquo;{rule.originalText}&rdquo;
      </p>
      <p className={styles.muted} style={{ margin: "6px 0 0" }}>
        {rule.allAccounts ? "Applies to all your ad accounts, including any you connect later" : `Applies to ${rule.accountIds.length} ad account${rule.accountIds.length === 1 ? "" : "s"}: ${rule.accountIds.slice(0, 3).map(nameOf).join(", ")}${rule.accountIds.length > 3 ? ` +${rule.accountIds.length - 3}` : ""}`}
        {" · "}added {new Date(rule.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
      </p>
      {editing && (
        <div style={{ marginTop: 10 }}>
          <ScopePicker accounts={accounts} scope={scope} onScope={setScope} selected={sel} onToggle={(id) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; })} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className={styles.btnPrimary} disabled={busy || (scope === "pick" && sel.size === 0)} onClick={() => patch({ allAccounts: scope === "all", accountIds: scope === "all" ? [] : [...sel] })}>
              Save accounts
            </button>
            <button type="button" className={styles.btnSecondary} onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <div className={styles.error} style={{ marginTop: 8 }}>{error}</div>}
      {!editing && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className={styles.btnSecondary} onClick={() => setEditing(true)} disabled={busy}>
            Change accounts
          </button>
          {confirmDelete ? (
            <>
              <span className={styles.sub} style={{ margin: 0 }}>Delete this rule?</span>
              <button type="button" className={styles.btnSecondary} style={{ color: "var(--red)" }} onClick={remove} disabled={busy}>
                Yes, delete
              </button>
              <button type="button" className={styles.btnSecondary} onClick={() => setConfirmDelete(false)} disabled={busy}>
                No
              </button>
            </>
          ) : (
            <button type="button" className={styles.btnSecondary} onClick={() => setConfirmDelete(true)} disabled={busy}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CustomRulesContent() {
  const { data: session, status } = useSession();
  const { adAccounts, accountsLoading, selectedAccountId } = useAccounts();
  const googleEmail = session?.googleEmail || null;

  const [rules, setRules] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [text, setText] = useState("");
  const [translating, setTranslating] = useState(false);
  const [tr, setTr] = useState(null); // the last translation answer
  const [testId, setTestId] = useState("");
  const [test, setTest] = useState(null);
  const [scope, setScope] = useState(""); // "" until the person chooses: "pick" | "all"
  const [name, setName] = useState("");
  const [level, setLevel] = useState(""); // what the rule applies to; "" until chosen
  const [actionType, setActionType] = useState(""); // what it does; "" until chosen
  const [stepPct, setStepPct] = useState("");
  const [sel, setSel] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!googleEmail) return;
    let cancelled = false;
    api("/api/fb/custom-rules")
      .then((out) => !cancelled && (out.error ? setLoadError(out.error) : setRules(out.rules)))
      .catch((err) => !cancelled && setLoadError(err.message));
    return () => {
      cancelled = true;
    };
  }, [googleEmail]);

  const testAccount = useMemo(() => adAccounts.find((a) => a.id === (testId || selectedAccountId)) || adAccounts[0] || null, [adAccounts, testId, selectedAccountId]);
  const symbol = currencySymbolOf(testAccount?.currency);

  // The form's choices; changing any of them makes an earlier reading of the conditions stale.
  const budgetAction = actionType === "INCREASE_BUDGET" || actionType === "DECREASE_BUDGET";
  const stepValid = !budgetAction || (Number(stepPct) >= 1 && Number(stepPct) <= 50);
  const formReady = !!level && !!actionType && stepValid && !!text.trim();
  const stale = () => {
    setTr(null);
    setTest(null);
  };

  const translate = useCallback(async () => {
    setTranslating(true);
    setTr(null);
    setTest(null);
    setSaveError(null);
    try {
      const action = budgetAction ? { type: actionType, stepPct: Number(stepPct) } : { type: actionType };
      const out = await post("/api/fb/custom-rules/translate", { text, currency: testAccount?.currency, level, action });
      setTr(out);
      if (out.status === "ok") {
        setScope("");
        setSel(new Set());
      }
      track("custom_rule_translated", { status: out.status });
    } catch (err) {
      setTr({ status: "error", message: err.message });
    } finally {
      setTranslating(false);
    }
  }, [text, testAccount, level, actionType, stepPct, budgetAction]);

  // The checked rule: the conditions as understood, with exactly the level and action chosen on the form.
  const edited = useMemo(() => (tr?.status === "ok" ? validateSpec(tr.spec) : null), [tr]);
  const reads = edited?.ok ? requiredData(edited.spec) : tr?.reads || [];
  const extra = edited?.ok ? extraFetches([edited.spec]) : tr?.extra || [];
  const settingMetrics = tr?.status === "ok" ? [...new Set(tr.spec.conditions.filter((c) => !RULE_METRICS[c.metric].windowed).map((c) => RULE_METRICS[c.metric].label))] : [];

  async function runTest() {
    if (!testAccount || !edited?.ok) return;
    setTest({ loading: true });
    try {
      const out = await post("/api/fb/custom-rules/test", { spec: edited.spec, accountId: testAccount.id, tz: testAccount.timezone_name });
      if (out.error) throw new Error(out.error);
      setTest(out);
      track("custom_rule_tested", { matches: out.total });
    } catch (err) {
      setTest({ error: err.message });
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const out = await post("/api/fb/custom-rules", { text, name: name.trim() || undefined, spec: edited.spec, allAccounts: scope === "all", accountIds: scope === "all" ? [] : [...sel], model: tr.model, promptVersion: tr.promptVersion });
      if (out.error) throw new Error(out.error);
      clearAllRuleCaches();
      track("custom_rule_saved", { level: edited.spec.level, action: edited.spec.action.type, conditions: edited.spec.conditions.length, all_accounts: scope === "all", named: !!name.trim() });
      setRules((prev) => [...(prev || []), out.rule]);
      setText("");
      setName("");
      setLevel("");
      setActionType("");
      setStepPct("");
      setTr(null);
      setTest(null);
      setSel(new Set());
      setScope("");
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const toggleSel = (id) =>
    setSel((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const canSave = !!edited?.ok && (scope === "all" || (scope === "pick" && sel.size > 0)) && !saving;

  return (
    <div className={styles.page}>
      <main className={styles.main} style={{ maxWidth: 900, margin: "0 auto", minWidth: 0 }}>
        <div>
          <h1 className={styles.h1}>Custom Rules</h1>
          <p className={styles.sub}>
            Write your own rule in plain language. It runs with the built-in recommendations on the ad accounts you choose, and when it disagrees with a built-in rule, yours wins. The same safety checks apply as for the built-in rules: only purchase-optimised items outside Meta&apos;s learning phase are judged, and budget changes are not suggested for 48 hours after a budget edit. Nothing is ever changed on Meta without you clicking apply.
          </p>
        </div>

        {status !== "loading" && !googleEmail ? (
          <div className={styles.card} style={{ padding: 20 }}>
            <p className={styles.sub} style={{ margin: 0 }}>Sign in with Google to write your own rules. They are saved to your Google account.</p>
          </div>
        ) : (
          <>
            <div className={styles.card} style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
              <h2 className={styles.h2} style={{ margin: 0 }}>Create a rule</h2>
              <p className={styles.sub} style={{ margin: 0 }}>Choose what it applies to and what it does, then describe the conditions in plain language.</p>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--t2)" }}>Rule name (optional)</span>
                <input className={styles.select} maxLength={80} placeholder="e.g. Scale winning ad sets" value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--t2)" }}>Applies to</span>
                <select
                  className={styles.select}
                  value={level}
                  onChange={(e) => {
                    const next = e.target.value;
                    setLevel(next);
                    // An action that doesn't exist for the new level (a budget change on ads) has to be chosen again.
                    if (actionType && !actionChoices(next).some((c) => c.type === actionType)) setActionType("");
                    stale();
                  }}
                >
                  <option value="" disabled>
                    Choose…
                  </option>
                  <option value="campaign">Campaign</option>
                  <option value="adset">Ad set</option>
                  <option value="ad">Ad</option>
                </select>
              </label>

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 280px", minWidth: 0 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--t2)" }}>Then</span>
                  <select
                    className={styles.select}
                    value={actionType}
                    disabled={!level}
                    onChange={(e) => {
                      setActionType(e.target.value);
                      stale();
                    }}
                  >
                    <option value="" disabled>
                      {level ? "Choose what should happen…" : "Choose what it applies to first"}
                    </option>
                    {level && actionChoices(level).map((c) => (
                      <option key={c.type} value={c.type}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, width: 150 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--t2)" }}>Value (%)</span>
                  <input
                    className={styles.select}
                    type="number"
                    min="1"
                    max="50"
                    placeholder="e.g. 20"
                    disabled={!budgetAction}
                    value={budgetAction ? stepPct : ""}
                    onChange={(e) => {
                      setStepPct(e.target.value);
                      stale();
                    }}
                  />
                </label>
              </div>
              {budgetAction && !stepValid && <p className={styles.sub} style={{ margin: 0, color: "var(--red)" }}>Enter how much to change the budget by, between 1% and 50%.</p>}

              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--t2)" }}>Conditions</span>
                <textarea
                  className={styles.select}
                  style={{ width: "100%", minHeight: 96, resize: "vertical", fontFamily: "inherit" }}
                  maxLength={MAX_TEXT}
                  placeholder={"e.g. If last 7 days ROAS is less than 2\nand budget is greater than 20000…"}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    stale();
                  }}
                />
              </label>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className={styles.btnPrimary} onClick={translate} disabled={translating || !formReady || accountsLoading}>
                  {translating ? "Reading your conditions…" : "Continue"}
                </button>
                <span className={styles.muted}>{text.length}/{MAX_TEXT}</span>
                {!formReady && <span className={styles.muted}>{!level ? "Choose what it applies to" : !actionType ? "Choose what should happen" : !stepValid ? "Enter the budget change" : "Describe the conditions"}</span>}
              </div>

              {tr?.status === "clarify" && (
                <div className={styles.card} style={{ padding: 12, borderColor: "var(--amber)" }}>
                  <strong>One thing to clarify</strong>
                  <p style={{ margin: "4px 0 0" }}>{tr.message}</p>
                  <p className={styles.sub} style={{ margin: "6px 0 0" }}>Add the detail to the conditions above and press Continue again.</p>
                </div>
              )}
              {tr?.status === "conflict" && (
                <div className={styles.card} style={{ padding: 12, borderColor: "var(--amber)" }}>
                  <strong>That combination doesn&apos;t work</strong>
                  <p style={{ margin: "4px 0 0" }}>{tr.message}</p>
                </div>
              )}
              {tr?.status === "unsupported" && (
                <div className={styles.card} style={{ padding: 12, borderColor: "var(--amber)" }}>
                  <strong>That can&apos;t be a rule yet</strong>
                  <p style={{ margin: "4px 0 0" }}>{tr.message}</p>
                </div>
              )}
              {tr?.status === "error" && <div className={styles.error}>{tr.message}</div>}

              {tr?.status === "ok" && (
                <div className={styles.card} style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12, borderColor: "var(--green)" }}>
                  <div>
                    <p className={styles.muted} style={{ margin: "0 0 4px" }}>Is this what you meant? Change the form above if not.</p>
                    <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{edited?.ok ? describeRule(edited.spec, symbol) : tr.sentence}</p>
                  </div>
                  {tr.assumptions.length > 0 && (
                    <div>
                      <p className={styles.muted} style={{ margin: "0 0 4px" }}>Assumed because the conditions didn&apos;t say</p>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                        {tr.assumptions.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <p className={styles.muted} style={{ margin: "0 0 4px" }}>How it is judged</p>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                      <li>
                        Data read: {readsText(reads.some((r) => r.window === 7) ? reads : [...reads, { window: 7, rowLevel: edited?.spec.level === "ad" ? "ad" : "adset" }])}
                        {settingMetrics.length > 0 ? `, and the item's current ${settingMetrics.join(" and ")}` : ""}.
                      </li>
                      <li>Only items that spent in the last 7 days (up to yesterday) are checked, so paused or idle ones are skipped. This applies to every rule.</li>
                      <li>Only items optimised for purchases or purchase value are checked, and items still in Meta&apos;s learning phase are skipped.</li>
                      {(edited?.spec.action?.type === "INCREASE_BUDGET" || edited?.spec.action?.type === "DECREASE_BUDGET") && <li>A budget change is not suggested for 48 hours after that budget was edited.</li>}
                      {extra.length > 0 && <li>Needs extra data the standard check doesn&apos;t read ({extraText(extra)}), so checks on your accounts take a little longer.</li>}
                    </ul>
                  </div>

                  <div>
                    <p className={styles.muted} style={{ margin: "0 0 6px" }}>Where should it apply? Choose one</p>
                    <ScopePicker accounts={adAccounts} scope={scope} onScope={setScope} selected={sel} onToggle={toggleSel} />
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <select className={styles.select} value={testAccount?.id || ""} onChange={(e) => setTestId(e.target.value)} aria-label="Ad account to test on">
                      {adAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <button type="button" className={styles.btnSecondary} onClick={runTest} disabled={!testAccount || !edited?.ok || test?.loading}>
                      Test on this account
                    </button>
                    <button type="button" className={styles.btnPrimary} onClick={save} disabled={!canSave}>
                      {saving ? "Saving…" : "Save rule"}
                    </button>
                  </div>
                  {!scope ? <p className={styles.sub} style={{ margin: 0 }}>Choose where the rule applies to save it.</p> : scope === "pick" && sel.size === 0 ? <p className={styles.sub} style={{ margin: 0 }}>Pick at least one ad account to save it.</p> : null}
                  {saveError && <div className={styles.error}>{saveError}</div>}
                  {test && <TestResults test={test} symbol={symbol} />}
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 className={styles.h2} style={{ margin: 0 }}>Your rules</h2>
              {loadError && <div className={styles.error}>{loadError}</div>}
              {!loadError && rules === null && <Loader label="Loading your rules…" />}
              {rules && rules.length === 0 && (
                <div className={styles.card} style={{ padding: 18 }}>
                  <p className={styles.sub} style={{ margin: 0 }}>No rules yet. Write one above and it will show here.</p>
                </div>
              )}
              {rules?.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  accounts={adAccounts}
                  symbol={symbol}
                  onChanged={(next) => setRules((prev) => (next ? prev.map((x) => (x.id === next.id ? next : x)) : prev.filter((x) => x.id !== r.id)))}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) return { redirect: { destination: "/", permanent: false } };
  return { props: { session: publicSession(session) } };
}
