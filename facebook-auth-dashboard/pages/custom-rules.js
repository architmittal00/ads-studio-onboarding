import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import LabeledPill from "@/components/LabeledPill";
import AccountSelect from "@/components/AccountSelect";
import { useAccounts } from "@/components/AccountProvider";
import { parseJsonResponse } from "@/lib/fetchJson";
import { describeRule, describeCondition, describeAction, validateSpec, requiredData, extraFetches, actionChoices, RULE_METRICS } from "@/lib/rules/customRule";
import { ChevronIcon, CloseIcon, EditIcon, PlusIcon, SlidersIcon } from "@/components/icons";
import { currencySymbolOf } from "@/lib/rules/leanFlag";
import { clearAllRuleCaches } from "@/lib/rules/useRuleAttention";
import { track } from "@/lib/analytics";
import styles from "@/styles/Home.module.css";

const MAX_TEXT = 600;
// One-click starting points for the Conditions box (added to what is already typed, joined with "and").
const CONDITION_EXAMPLES = ["Last 7 days ROAS is below 2", "Budget is greater than 20000", "Last 7 days spend is above 5000 and purchases are fewer than 3", "Last 3 days cost per purchase is 30% above the account's"];
const TYPE_LABEL = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const NOUN = { campaign: "campaign", adset: "ad set", ad: "ad" };
const LEVEL_FOR_READS = { ad: "per ad", adset: "per ad set" };
const ACTION_BADGE = { PAUSE_AD: [styles.badgeDanger, "Pause"], INCREASE_BUDGET: [styles.badgeGood, "Raise budget"], DECREASE_BUDGET: [styles.badgeWarn, "Lower budget"], NOTE: [styles.badgeInfo, "Flag"] };

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
      <CustomRulesContent />
    </Layout>
  );
}

// "7-day, per ad" lines for what a rule reads (the data it needs).
const readsText = (reads) => reads.map((r) => `${r.window === 1 ? "yesterday" : `${r.window}-day`} ${LEVEL_FOR_READS[r.rowLevel]}`).join(", ");
const extraText = (extra) => extra.map((r) => `${r.window === 1 ? "yesterday" : `${r.window}-day`} figures ${LEVEL_FOR_READS[r.rowLevel]}`).join(", ");

// What the person can pick under "Then" for a level, with short labels (the choices themselves come from actionChoices).
const actionOptions = (level) =>
  actionChoices(level).map((c) => ({
    value: c.type,
    label: c.type === "PAUSE" ? `Pause ${NOUN[level]}` : c.type === "FLAG" ? "Only flag it" : c.type === "INCREASE_BUDGET" ? "Increase budget" : "Decrease budget",
  }));

// The app's segmented choice (same markup as Custom Views' "Compare" switch): `.tabGroup` of `.tab` radios.
function Segmented({ label, value, onChange, options }) {
  return (
    <div className={styles.tabGroup} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Where a rule applies. Nothing is pre-selected on a new rule: the person must choose. "all" is looked at every time an ad
// account is checked, so an ad account connected later is covered automatically.
function ScopeChoice({ accounts, loading, scope, onScope, ids, onIds }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Segmented
        label="Where the rule applies"
        value={scope}
        onChange={onScope}
        options={[
          { value: "pick", label: "Only the ad accounts I pick" },
          { value: "all", label: "All my ad accounts" },
        ]}
      />
      {scope === "pick" && <AccountSelect accounts={accounts} multiple values={ids} onChange={onIds} placeholder="Search and add ad accounts…" loading={loading} style={{ width: "100%", maxWidth: 520 }} />}
      <p className={styles.sub} style={{ margin: 0 }}>
        {scope === "all"
          ? `Runs on every ad account you can check (${accounts.length} now), including any you connect later.`
          : scope === "pick"
            ? "A new ad account is not included unless you add it here later."
            : "Choose one."}
      </p>
    </div>
  );
}

function TestResults({ test, symbol }) {
  if (test.loading) return <Loader label="Reading the account and trying the rule… this can take up to a minute on a big account." />;
  if (test.error) return <div className={styles.error}>{test.error}</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div>
        <p className={styles.h2} style={{ margin: 0 }}>
          {test.total === 0 ? "Nothing would be flagged right now." : `Would flag ${test.total} item${test.total === 1 ? "" : "s"} right now${test.total > test.matches.length ? ` (showing ${test.matches.length})` : ""}.`}
        </p>
        <p className={styles.sub} style={{ margin: "4px 0 0" }}>
          Based on the last full days. Only purchase-optimised items outside Meta&apos;s learning phase with delivery in the last 7 days are checked{test.heldChecked ? ", and budget suggestions are skipped for 48 hours after a budget edit" : ""}.
        </p>
      </div>
      {test.matches.length > 0 && (
        <div className={styles.cardList}>
          {test.matches.map((m) => {
            const [badge, word] = ACTION_BADGE[m.action] || ACTION_BADGE.NOTE;
            return (
              <div key={m.key} className={styles.rowCard}>
                <div className={styles.rowCardHead}>
                  <div className={styles.rowCardTitleBtn} style={{ cursor: "default", minWidth: 0 }}>
                    <span className={styles.rowCardTitle}>{m.name}</span>
                    <span className={styles.rowCardSub} style={{ overflowWrap: "anywhere" }}>
                      {TYPE_LABEL[m.entityType]} · {symbol}
                      {Math.round(m.spend7).toLocaleString("en-IN")} spent in 7 days
                    </span>
                  </div>
                  <span className={badge}>{word}</span>
                </div>
                <div className={styles.rowCardSub} style={{ overflowWrap: "anywhere" }}>
                  {m.conditions.flatMap((c) => (c.either ? c.either.filter((o) => o.ok) : [c])).map((c) => `${c.label} (now ${c.actual})`).join("; ")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const LEVEL_ORDER = ["campaign", "adset", "ad"];
const LEVEL_TAB = { campaign: "Campaign", adset: "Ad set", ad: "Ad" };
const LEVEL_HEAD = { campaign: "Campaign level", adset: "Ad set level", ad: "Ad level" };

// The short label on a rule's row: what it does, e.g. "Increase budget by 20%".
function actionBadge(spec) {
  const noun = NOUN[spec.level];
  switch (spec.action.type) {
    case "PAUSE":
      return [styles.badgeDanger, `Pause ${noun}`];
    case "INCREASE_BUDGET":
      return [styles.badgeGood, `Increase budget by ${spec.action.stepPct}%`];
    case "DECREASE_BUDGET":
      return [styles.badgeWarn, `Decrease budget by ${spec.action.stepPct}%`];
    default:
      return [styles.badgeInfo, "Flag only"];
  }
}

function ruleScopeText(rule, nameOf) {
  if (rule.allAccounts) return "All your ad accounts, including any you connect later";
  const names = rule.accountIds.slice(0, 3).map(nameOf).join(", ");
  return `${rule.accountIds.length} ad account${rule.accountIds.length === 1 ? "" : "s"}: ${names}${rule.accountIds.length > 3 ? ` +${rule.accountIds.length - 3}` : ""}`;
}

// One saved rule: a compact row (name, what it does, edit, on / off, expand) that opens to its conditions and what it does.
function RuleItem({ rule, accounts, accountsLoading, symbol, open, onToggleOpen, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [name, setName] = useState(rule.name);
  const [scope, setScope] = useState(rule.allAccounts ? "all" : "pick");
  const [ids, setIds] = useState(rule.accountIds);
  const nameOf = (id) => accounts.find((a) => a.id === id)?.name || id;
  const [badge, badgeText] = actionBadge(rule.spec);
  const conds = rule.spec.conditions;
  const joiner = rule.spec.match === "any" ? "OR" : "AND";

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
  const stop = (e) => e.stopPropagation();

  return (
    <div className={open ? `${styles.ruleItem} ${styles.ruleItemOpen}` : styles.ruleItem} style={{ opacity: rule.enabled ? 1 : 0.7 }}>
      <div className={styles.ruleItemHead} onClick={onToggleOpen}>
        <div className={styles.ruleItemTitle}>
          <span className={styles.h2} style={{ overflowWrap: "anywhere" }}>{rule.name}</span>
          <span className={styles.sub}>
            {conds.length} condition{conds.length === 1 ? "" : "s"} · {rule.allAccounts ? "all ad accounts" : `${rule.accountIds.length} ad account${rule.accountIds.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <span className={badge}>{badgeText}</span>
        <button
          type="button"
          className={styles.btnSecondary}
          style={{ padding: "6px 8px", display: "inline-flex" }}
          aria-label="Edit name and accounts"
          title="Edit name and accounts"
          onClick={(e) => {
            stop(e);
            if (!open) onToggleOpen();
            setEditing(true);
          }}
        >
          <EditIcon size={14} />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={rule.enabled}
          aria-label={rule.enabled ? "Turn this rule off" : "Turn this rule on"}
          title={rule.enabled ? "On: click to turn off" : "Off: click to turn on"}
          className={rule.enabled ? `${styles.switch} ${styles.switchOn}` : styles.switch}
          disabled={busy}
          onClick={(e) => {
            stop(e);
            patch({ enabled: !rule.enabled }, "custom_rule_toggled");
          }}
        />
        <button type="button" className={styles.btnSecondary} style={{ padding: "6px 8px", display: "inline-flex" }} aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={(e) => { stop(e); onToggleOpen(); }}>
          <ChevronIcon direction={open ? "up" : "down"} size={14} />
        </button>
      </div>

      {open && (
        <div className={styles.ruleItemBody}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <p className={styles.muted} style={{ margin: 0, textTransform: "uppercase", letterSpacing: ".06em" }}>
              Conditions — {rule.spec.match === "any" ? "any one must be true" : "all must be true"}
            </p>
            {conds.map((c, i) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {i > 0 && <span className={styles.pill} style={{ alignSelf: "flex-start" }}>{joiner}</span>}
                <div className={styles.ruleCond}>
                  <span className={styles.ruleCondDot} />
                  <span style={{ overflowWrap: "anywhere" }}>{describeCondition(c, symbol)}</span>
                </div>
              </div>
            ))}
            <p className={styles.sub} style={{ margin: "6px 0 0", overflowWrap: "anywhere" }}>
              You wrote: &ldquo;{rule.originalText}&rdquo;
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <p className={styles.muted} style={{ margin: 0, textTransform: "uppercase", letterSpacing: ".06em" }}>Then</p>
            <div className={styles.ruleThen}>
              <span className={badge} style={{ alignSelf: "flex-start" }}>{badgeText}</span>
              <span className={styles.sub}>{describeAction(rule.spec.action)} on {LEVEL_TAB[rule.spec.level].toLowerCase()}s that match.</span>
            </div>
            <p className={styles.sub} style={{ margin: 0, overflowWrap: "anywhere" }}>
              Applies to: {ruleScopeText(rule, nameOf)}
            </p>
            <p className={styles.sub} style={{ margin: 0 }}>
              Added {new Date(rule.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>

          <div style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 10 }}>
            {editing && (
              <div className={styles.ruleThen}>
                <LabeledPill label="Rule name">
                  <input className={styles.select} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", maxWidth: 420 }} />
                </LabeledPill>
                <LabeledPill label="Where it applies">
                  <ScopeChoice accounts={accounts} loading={accountsLoading} scope={scope} onScope={setScope} ids={ids} onIds={setIds} />
                </LabeledPill>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className={styles.btnPrimary} disabled={busy || !name.trim() || (scope === "pick" && ids.length === 0)} onClick={() => patch({ name: name.trim(), allAccounts: scope === "all", accountIds: scope === "all" ? [] : ids })}>
                    Save changes
                  </button>
                  <button type="button" className={styles.btnSecondary} onClick={() => setEditing(false)} disabled={busy}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
            {error && <div className={styles.error}>{error}</div>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {confirmDelete ? (
                <>
                  <span className={styles.sub}>Delete this rule?</span>
                  <button type="button" className={styles.btnSecondary} style={{ color: "var(--red)" }} onClick={remove} disabled={busy}>
                    Yes, delete
                  </button>
                  <button type="button" className={styles.btnSecondary} onClick={() => setConfirmDelete(false)} disabled={busy}>
                    No
                  </button>
                </>
              ) : (
                <button type="button" className={styles.btnSecondary} onClick={() => setConfirmDelete(true)} disabled={busy}>
                  Delete rule
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// "Your rules": filter tabs with counts (All / Campaign / Ad set / Ad), the rules grouped by the level they judge, each as a row.
function RulesList({ rules, accounts, accountsLoading, symbol, onChanged }) {
  const [tab, setTab] = useState("all");
  const [openId, setOpenId] = useState(null);
  const counts = { all: rules.length, campaign: 0, adset: 0, ad: 0 };
  for (const r of rules) counts[r.spec.level]++;
  const groups = LEVEL_ORDER.filter((l) => (tab === "all" || tab === l) && counts[l] > 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className={styles.tabGroup} role="tablist" aria-label="Filter rules by level">
        {[["all", "All"], ...LEVEL_ORDER.map((l) => [l, LEVEL_TAB[l]])].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setTab(key)}>
            {label}
            <span className={styles.tabCount}>{counts[key]}</span>
          </button>
        ))}
      </div>
      {groups.length === 0 && (
        <div className={styles.card}>
          <p className={styles.sub} style={{ margin: 0 }}>No {LEVEL_TAB[tab]?.toLowerCase()} rules yet.</p>
        </div>
      )}
      {groups.map((l) => (
        <div key={l} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div className={styles.ruleGroupHead}>
            <span>{LEVEL_HEAD[l]}</span>
            <span className={styles.tabCount} style={{ marginLeft: 0 }}>{counts[l]}</span>
          </div>
          {rules
            .filter((r) => r.spec.level === l)
            .map((r) => (
              <RuleItem
                key={r.id}
                rule={r}
                accounts={accounts}
                accountsLoading={accountsLoading}
                symbol={symbol}
                open={openId === r.id}
                onToggleOpen={() => setOpenId((cur) => (cur === r.id ? null : r.id))}
                onChanged={(next) => onChanged(r.id, next)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}

function CustomRulesContent() {
  const { data: session, status } = useSession();
  const { adAccounts, accountsLoading, selectedAccountId } = useAccounts();
  const googleEmail = session?.googleEmail || null;

  const [rules, setRules] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState(""); // what the rule applies to; "" until chosen
  const [actionType, setActionType] = useState(""); // what it does; "" until chosen
  const [stepPct, setStepPct] = useState("");
  const [text, setText] = useState("");
  const [translating, setTranslating] = useState(false);
  const [tr, setTr] = useState(null); // the last translation answer
  const [testId, setTestId] = useState("");
  const [test, setTest] = useState(null);
  const [testOpen, setTestOpen] = useState(false); // the test controls stay hidden until "Test this rule" is clicked
  const [scope, setScope] = useState(""); // "" until the person chooses: "pick" | "all"
  const [ids, setIds] = useState([]);
  const [creating, setCreating] = useState(false); // the create form is hidden until "New rule" is clicked
  const [howOpen, setHowOpen] = useState(false); // "How rules are judged"
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

  // The account a test runs on: the one picked in the test panel, else the first ad account chosen for the rule, else the one open elsewhere.
  const firstPicked = scope === "pick" ? ids[0] : null;
  const testAccount = useMemo(() => adAccounts.find((a) => a.id === (testId || firstPicked || selectedAccountId)) || adAccounts[0] || null, [adAccounts, testId, firstPicked, selectedAccountId]);
  const symbol = currencySymbolOf(testAccount?.currency);

  // The form's choices; changing any of them makes an earlier reading of the conditions stale.
  const budgetAction = actionType === "INCREASE_BUDGET" || actionType === "DECREASE_BUDGET";
  const stepValid = !budgetAction || (Number(stepPct) >= 1 && Number(stepPct) <= 50);
  const formReady = !!level && !!actionType && stepValid && !!text.trim();
  const stale = () => {
    setTr(null);
    setTest(null);
    setTestOpen(false);
  };

  const translate = useCallback(async () => {
    setTranslating(true);
    setTr(null);
    setTest(null);
    setTestOpen(false);
    setSaveError(null);
    try {
      const action = budgetAction ? { type: actionType, stepPct: Number(stepPct) } : { type: actionType };
      const out = await post("/api/fb/custom-rules/translate", { text, currency: testAccount?.currency, level, action });
      setTr(out);
      if (out.status === "ok") {
        setScope("");
        setIds([]);
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
  const specBudgetAction = edited?.ok && (edited.spec.action.type === "INCREASE_BUDGET" || edited.spec.action.type === "DECREASE_BUDGET");

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
      const out = await post("/api/fb/custom-rules", { text, name: name.trim() || undefined, spec: edited.spec, allAccounts: scope === "all", accountIds: scope === "all" ? [] : ids, model: tr.model, promptVersion: tr.promptVersion });
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
      setTestOpen(false);
      setIds([]);
      setScope("");
      setCreating(false);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const canSave = !!edited?.ok && (scope === "all" || (scope === "pick" && ids.length > 0)) && !saving;

  return (
    <div className={styles.page}>
      <main className={styles.main} style={{ maxWidth: 900, margin: "0 auto", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 360px", minWidth: 0 }}>
            <h1 className={styles.h1}>Custom Rules</h1>
            <p className={styles.sub}>Write your own recommendation rules in plain language. They run with the built-in ones on the ad accounts you choose, and yours win when they disagree.</p>
            <button type="button" className={styles.btnSecondary} style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }} aria-expanded={howOpen} onClick={() => setHowOpen((o) => !o)}>
              How rules are judged
              <ChevronIcon direction={howOpen ? "up" : "down"} size={12} />
            </button>
          </div>
          {googleEmail && (
            <button type="button" className={creating ? styles.btnSecondary : styles.btnPrimary} style={{ display: "inline-flex", alignItems: "center", gap: 6 }} onClick={() => setCreating((c) => !c)}>
              {creating ? <CloseIcon size={13} /> : <PlusIcon size={14} />}
              {creating ? "Close" : "New rule"}
            </button>
          )}
        </div>
        {howOpen && (
          <div className={styles.card}>
            <ul className={styles.sub} style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
              <li>Only items optimised for purchases or purchase value are judged, and items still in Meta&apos;s learning phase are skipped.</li>
              <li>Only items that spent in the last 7 days (up to yesterday) are checked, so paused or idle ones are left alone.</li>
              <li>A budget change is not suggested for 48 hours after that budget was edited.</li>
              <li>When one of your rules and a built-in rule both match an item, yours is shown.</li>
              <li>Nothing is ever changed on Meta until you click apply.</li>
            </ul>
          </div>
        )}

        {status !== "loading" && !googleEmail ? (
          <div className={styles.card}>
            <p className={styles.sub} style={{ margin: 0 }}>Sign in with Google to write your own rules. They are saved to your Google account.</p>
          </div>
        ) : (
          <>
            {creating && (
            <div className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <h2 className={styles.h2} style={{ margin: 0 }}>Create a rule</h2>
                <p className={styles.sub} style={{ margin: "2px 0 0" }}>Choose what it applies to and what it does, then describe the conditions in plain language.</p>
              </div>

              <LabeledPill label="Rule name (optional)">
                <input className={styles.select} maxLength={80} placeholder="e.g. Scale winning ad sets" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%", maxWidth: 520 }} />
              </LabeledPill>

              <LabeledPill label="Applies to">
                <Segmented
                  label="Applies to"
                  value={level}
                  onChange={(next) => {
                    setLevel(next);
                    // An action that doesn't exist for the new level (a budget change on ads) has to be chosen again.
                    if (actionType && !actionChoices(next).some((c) => c.type === actionType)) setActionType("");
                    stale();
                  }}
                  options={[
                    { value: "campaign", label: "Campaign" },
                    { value: "adset", label: "Ad set" },
                    { value: "ad", label: "Ad" },
                  ]}
                />
              </LabeledPill>

              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-end" }}>
                <LabeledPill label="Then">
                  {level ? (
                    <Segmented
                      label="What the rule does"
                      value={actionType}
                      onChange={(next) => {
                        setActionType(next);
                        stale();
                      }}
                      options={actionOptions(level)}
                    />
                  ) : (
                    <span className={styles.sub}>Choose what it applies to first</span>
                  )}
                </LabeledPill>
                {budgetAction && (
                  <LabeledPill label="Value (%)">
                    <input
                      className={styles.select}
                      type="number"
                      min="1"
                      max="50"
                      placeholder="e.g. 20"
                      value={stepPct}
                      style={{ width: 110 }}
                      onChange={(e) => {
                        setStepPct(e.target.value);
                        stale();
                      }}
                    />
                  </LabeledPill>
                )}
              </div>
              {budgetAction && !stepValid && <p className={styles.sub} style={{ margin: 0, color: "var(--red)" }}>Enter how much to change the budget by, between 1% and 50%.</p>}

              <LabeledPill label="Conditions">
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
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
                  <span className={styles.muted}>Try:</span>
                  {CONDITION_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      className={styles.btnSecondary}
                      style={{ padding: "4px 10px", fontSize: 11.5 }}
                      onClick={() => {
                        setText((prev) => {
                          const cur = prev.trim();
                          return (cur ? `${cur} and ${ex.charAt(0).toLowerCase()}${ex.slice(1)}` : ex).slice(0, MAX_TEXT);
                        });
                        stale();
                      }}
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </LabeledPill>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className={styles.btnPrimary} onClick={translate} disabled={translating || !formReady || accountsLoading}>
                  {translating ? "Reading your conditions…" : "Continue"}
                </button>
                <span className={styles.muted}>{text.length}/{MAX_TEXT}</span>
                {!formReady && <span className={styles.muted}>{!level ? "Choose what it applies to" : !actionType ? "Choose what should happen" : !stepValid ? "Enter the budget change" : "Describe the conditions"}</span>}
              </div>

              {tr?.status === "clarify" && (
                <div className={styles.card} style={{ borderColor: "var(--amber)" }}>
                  <p className={styles.h2} style={{ margin: 0 }}>One thing to clarify</p>
                  <p style={{ margin: "4px 0 0" }}>{tr.message}</p>
                  <p className={styles.sub} style={{ margin: "6px 0 0" }}>Add the detail to the conditions above and press Continue again.</p>
                </div>
              )}
              {tr?.status === "conflict" && (
                <div className={styles.card} style={{ borderColor: "var(--amber)" }}>
                  <p className={styles.h2} style={{ margin: 0 }}>That combination doesn&apos;t work</p>
                  <p style={{ margin: "4px 0 0" }}>{tr.message}</p>
                </div>
              )}
              {tr?.status === "unsupported" && (
                <div className={styles.card} style={{ borderColor: "var(--amber)" }}>
                  <p className={styles.h2} style={{ margin: 0 }}>That can&apos;t be a rule yet</p>
                  <p style={{ margin: "4px 0 0" }}>{tr.message}</p>
                </div>
              )}
              {tr?.status === "error" && <div className={styles.error}>{tr.message}</div>}

              {tr?.status === "ok" && (
                <div className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 14, borderColor: "var(--green)" }}>
                  <div>
                    <p className={styles.muted} style={{ margin: "0 0 4px" }}>Is this what you meant? Change the form above if not.</p>
                    <p className={styles.h2} style={{ margin: 0 }}>{edited?.ok ? describeRule(edited.spec, symbol) : tr.sentence}</p>
                  </div>
                  {tr.assumptions.length > 0 && (
                    <div>
                      <p className={styles.muted} style={{ margin: "0 0 4px" }}>Assumed because the conditions didn&apos;t say</p>
                      <ul className={styles.sub} style={{ margin: 0, paddingLeft: 18 }}>
                        {tr.assumptions.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <p className={styles.muted} style={{ margin: "0 0 4px" }}>How it is judged</p>
                    <ul className={styles.sub} style={{ margin: 0, paddingLeft: 18 }}>
                      <li>
                        Data read: {readsText(reads.some((r) => r.window === 7) ? reads : [...reads, { window: 7, rowLevel: edited?.spec.level === "ad" ? "ad" : "adset" }])}
                        {settingMetrics.length > 0 ? `, and the item's current ${settingMetrics.join(" and ")}` : ""}.
                      </li>
                      <li>Only items that spent in the last 7 days (up to yesterday) are checked, so paused or idle ones are skipped. This applies to every rule.</li>
                      <li>Only items optimised for purchases or purchase value are checked, and items still in Meta&apos;s learning phase are skipped.</li>
                      {specBudgetAction && <li>A budget change is not suggested for 48 hours after that budget was edited.</li>}
                      {extra.length > 0 && <li>Needs extra data the standard check doesn&apos;t read ({extraText(extra)}), so checks on your accounts take a little longer.</li>}
                    </ul>
                  </div>

                  <LabeledPill label="Where should it apply?">
                    <ScopeChoice accounts={adAccounts} loading={accountsLoading} scope={scope} onScope={setScope} ids={ids} onIds={setIds} />
                  </LabeledPill>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <button type="button" className={styles.btnSecondary} onClick={() => setTestOpen((o) => !o)} disabled={!edited?.ok} aria-expanded={testOpen}>
                      {testOpen ? "Hide test" : "Test this rule"}
                    </button>
                    <button type="button" className={styles.btnPrimary} onClick={save} disabled={!canSave}>
                      {saving ? "Saving…" : "Save rule"}
                    </button>
                  </div>
                  {!scope ? <p className={styles.sub} style={{ margin: 0 }}>Choose where the rule applies to save it.</p> : scope === "pick" && ids.length === 0 ? <p className={styles.sub} style={{ margin: 0 }}>Pick at least one ad account to save it.</p> : null}
                  {saveError && <div className={styles.error}>{saveError}</div>}
                  {testOpen && (
                    <div className={styles.card} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <div>
                        <p className={styles.h2} style={{ margin: 0 }}>Test this rule</p>
                        <p className={styles.sub} style={{ margin: "2px 0 0" }}>See what it would flag on one ad account right now. Nothing is saved or changed.</p>
                      </div>
                      <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
                        <LabeledPill label="Test on">
                          <AccountSelect accounts={adAccounts} value={testAccount?.id || ""} onChange={setTestId} placeholder="Choose an ad account…" loading={accountsLoading} style={{ width: 300, maxWidth: "100%" }} />
                        </LabeledPill>
                        <button type="button" className={styles.btnPrimary} onClick={runTest} disabled={!testAccount || !edited?.ok || test?.loading}>
                          {test?.loading ? "Testing…" : "Run test"}
                        </button>
                      </div>
                      {test && <TestResults test={test} symbol={symbol} />}
                    </div>
                  )}
                </div>
              )}
            </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h2 className={styles.h2} style={{ margin: 0 }}>Your rules{rules && rules.length > 0 ? ` (${rules.length})` : ""}</h2>
              {loadError && <div className={styles.error}>{loadError}</div>}
              {!loadError && rules === null && <Loader label="Loading your rules…" />}
              {rules && rules.length === 0 && (
                <section className={styles.card}>
                  <div className={styles.exploreEmptyState}>
                    <div className={styles.exploreEmptyIcon}>
                      <SlidersIcon size={26} />
                    </div>
                    <div>
                      <h2 className={styles.h2} style={{ marginBottom: 6 }}>
                        No custom rules yet
                      </h2>
                      <p className={styles.sub}>Turn what you already check by hand into a rule, and it shows up in Recommendations on the ad accounts you pick.</p>
                    </div>
                    <div className={styles.exploreEmptySteps}>
                      {["Choose what it applies to and what it does", "Describe the conditions in plain language", "Review it, test it, and pick the ad accounts"].map((step, i) => (
                        <div key={step} className={styles.exploreEmptyStep}>
                          <span className={styles.exploreEmptyStepNum}>{i + 1}</span>
                          {step}
                        </div>
                      ))}
                    </div>
                    {!creating && (
                      <button type="button" className={styles.btnPrimary} onClick={() => setCreating(true)}>
                        Create your first rule
                      </button>
                    )}
                  </div>
                </section>
              )}
              {rules && rules.length > 0 && (
                <RulesList
                  rules={rules}
                  accounts={adAccounts}
                  accountsLoading={accountsLoading}
                  symbol={symbol}
                  onChanged={(id, next) => setRules((prev) => (next ? prev.map((x) => (x.id === next.id ? next : x)) : prev.filter((x) => x.id !== id)))}
                />
              )}
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
