import { useEffect, useRef, useState } from "react";
import styles from "@/styles/Home.module.css";
import { formatMetricValue, LEVEL_OPTIONS } from "@/lib/insightsMetrics";
import { CloseIcon, ChevronIcon, PauseIcon, PlayIcon } from "./icons";

// Quick budget bumps — the common "cut it back" / "push it harder" pacing
// moves a performance marketer actually reaches for, rather than typing an
// exact new number every time. The input below is still there for an exact
// value; these just pre-fill it.
const BUDGET_PRESETS = [-50, -20, -10, 10, 20, 50];

// What's actually actionable on this one row, given what Explore already
// knows about it:
//  - Pause/Activate only offered when the current status is cleanly one of
//    those two — a disapproved/pending/archived entity isn't something this
//    simple toggle should pretend to control.
//  - Change Budget only offered when this exact entity (not its parent or
//    children) owns a budget field — pages/api/fb/explore-insights.js only
//    ever sets dailyBudget/lifetimeBudget here when that's true, which is
//    exactly the CBO/ABO-aware check this feature needs (see that file's
//    fetchEntityBudgets comment).
function determineActions(row) {
  const actions = [];
  if (row.status === "ACTIVE") {
    actions.push({ key: "pause", kind: "status", label: "Pause", nextStatus: "PAUSED" });
  } else if (row.status === "PAUSED") {
    actions.push({ key: "activate", kind: "status", label: "Activate", nextStatus: "ACTIVE" });
  }
  if (row.dailyBudget != null) {
    actions.push({ key: "budget", kind: "budget", label: "Change Budget", field: "daily_budget", currentValue: row.dailyBudget });
  } else if (row.lifetimeBudget != null) {
    actions.push({ key: "budget", kind: "budget", label: "Change Budget", field: "lifetime_budget", currentValue: row.lifetimeBudget });
  }
  return actions;
}

// Row-level "take an action without leaving this view" control for
// Explore's results table — one action shown directly as a button, several
// shown behind a small "Take Action" menu, nothing shown at all when this
// row has no single entity to act on or nothing about it is actionable.
export default function RowActions({ row, level, currency, onActionApplied }) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Viewport-relative {top, right} for the open menu, computed from the
  // trigger button's own getBoundingClientRect() at open time — see the
  // .rowActionMenu comment in styles/Home.module.css for why this can't just
  // be `position: absolute` anchored to the button.
  const [menuPos, setMenuPos] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const triggerRef = useRef(null);

  // A fixed-position menu doesn't move when its *ancestor* scrolls (unlike
  // the old absolutely-positioned one, which rode along with the row) — the
  // table's own internal scroll (`.tableScroll`) wouldn't fire a listener
  // attached to the menu or the window in the bubble phase, since an
  // element's own scroll event doesn't bubble, so this listens during the
  // capture phase instead, which does see it. Closing on any scroll avoids a
  // menu silently drifting away from the button it belongs to.
  useEffect(() => {
    if (!menuOpen) return;
    function close() {
      setMenuOpen(false);
    }
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [menuOpen]);

  if (!row.entityId) return null;
  const actions = determineActions(row);
  if (actions.length === 0) return <span className={styles.muted}>—</span>;

  function openAction(action) {
    setMenuOpen(false);
    setPendingAction(action);
  }

  function toggleMenu() {
    if (!menuOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    }
    setMenuOpen((o) => !o);
  }

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      {actions.length === 1 ? (
        <ActionTriggerButton action={actions[0]} onClick={() => openAction(actions[0])} />
      ) : (
        <>
          <button
            ref={triggerRef}
            type="button"
            className={styles.rowActionBtn}
            onClick={toggleMenu}
            onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
          >
            Take Action
            <ChevronIcon direction={menuOpen ? "up" : "down"} size={10} />
          </button>
          {menuOpen && menuPos && (
            <div className={styles.rowActionMenu} style={{ position: "fixed", top: menuPos.top, right: menuPos.right }}>
              {actions.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={styles.rowActionMenuItem}
                  onMouseDown={() => openAction(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {pendingAction && (
        <ActionConfirmModal
          row={row}
          level={level}
          action={pendingAction}
          currency={currency}
          onClose={() => setPendingAction(null)}
          onApplied={(patch) => {
            setPendingAction(null);
            onActionApplied(row.entityId, patch);
          }}
        />
      )}
    </div>
  );
}

function ActionTriggerButton({ action, onClick }) {
  return (
    <button type="button" className={styles.rowActionBtn} onClick={onClick}>
      {action.kind === "status" ? (
        action.nextStatus === "PAUSED" ? (
          <PauseIcon size={11} />
        ) : (
          <PlayIcon size={11} />
        )
      ) : null}
      {action.label}
    </button>
  );
}

function ActionConfirmModal({ row, level, action, currency, onClose, onApplied }) {
  const [budgetInput, setBudgetInput] = useState(action.kind === "budget" ? String(action.currentValue ?? "") : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [loading, onClose]);

  const levelLabel = LEVEL_OPTIONS.find((l) => l.value === level)?.label || "entity";
  const newBudgetValue = action.kind === "budget" ? parseFloat(budgetInput) : null;
  const budgetValid = action.kind !== "budget" || (Number.isFinite(newBudgetValue) && newBudgetValue > 0);

  async function handleConfirm() {
    if (!budgetValid || loading) return;
    setLoading(true);
    setError(null);
    try {
      const body =
        action.kind === "status"
          ? { entityId: row.entityId, action: action.nextStatus === "ACTIVE" ? "activate" : "pause" }
          : {
              entityId: row.entityId,
              action: action.field === "daily_budget" ? "set_daily_budget" : "set_lifetime_budget",
              value: newBudgetValue,
            };
      const res = await fetch("/api/fb/entity-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Request failed");
      onApplied(
        action.kind === "status"
          ? { status: action.nextStatus }
          : { [action.field === "daily_budget" ? "dailyBudget" : "lifetimeBudget"]: newBudgetValue }
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      onClick={loading ? undefined : onClose}
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
      <div onClick={(e) => e.stopPropagation()} className={styles.card} style={{ background: "var(--bg)", width: "min(380px, 100%)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div>
            <h2 className={styles.h2} style={{ marginBottom: 2 }}>
              {action.kind === "status" ? action.label : "Change Budget"}
            </h2>
            <p className={styles.sub}>
              {levelLabel}: {row.entityLabel || row.label}
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={loading} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {action.kind === "status" ? (
          <p className={styles.sub} style={{ marginTop: 16 }}>
            This will {action.nextStatus === "PAUSED" ? "pause" : "activate"} this {levelLabel.toLowerCase()} on Facebook
            immediately.
          </p>
        ) : (
          <div style={{ marginTop: 16 }}>
            <p className={styles.sub}>
              Current {action.field === "daily_budget" ? "daily" : "lifetime"} budget:{" "}
              <strong style={{ color: "var(--t1)" }}>{formatMetricValue(action.currentValue, "currency", currency)}</strong>
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {BUDGET_PRESETS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  className={styles.btnSecondary}
                  onClick={() => setBudgetInput(String(Math.round(action.currentValue * (1 + pct / 100) * 100) / 100))}
                >
                  {pct > 0 ? `+${pct}%` : `${pct}%`}
                </button>
              ))}
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              className={styles.select}
              style={{ width: "100%", marginTop: 10 }}
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
            />
            {budgetInput.trim() && !budgetValid && (
              <p className={styles.sub} style={{ color: "var(--red)", marginTop: 6 }}>
                Enter a budget greater than zero.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className={styles.error} style={{ marginTop: 14 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 18, justifyContent: "flex-end" }}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button type="button" className={styles.btnPrimary} onClick={handleConfirm} disabled={loading || !budgetValid}>
            {loading ? "Applying…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
