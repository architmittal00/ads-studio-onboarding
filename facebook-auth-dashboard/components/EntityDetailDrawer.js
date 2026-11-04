import { useEffect, useRef, useState } from "react";
import { CloseIcon } from "./icons";
import { LEVEL_OPTIONS } from "@/lib/insightsMetrics";
import AdDetailsPanel from "./AdDetailsPanel";
import AdSetDetailsPanel from "./AdSetDetailsPanel";
import CampaignDetailsPanel from "./CampaignDetailsPanel";
import styles from "@/styles/Home.module.css";

// "How is this actually set up" drawer for one Campaign/Ad Set/Ad (read-only
// for campaigns and ad sets; ads can also be edited — see AdDetailsPanel) —
// for one Campaign/Ad Set/Ad
// row in Explore — deliberately a side drawer (components/EntityChangesDrawer.js's
// own .drawerOverlay/.drawerPanel convention), never a navigation elsewhere:
// this is about understanding a row without losing your place in the table.
// `entity` is `{ level: "campaign"|"adset"|"ad", id, name }`; data for each
// level comes from /api/fb/entity-details (see lib/entityDetails.js for what
// each level actually fetches/resolves).
export default function EntityDetailDrawer({ entity, onClose, onNavigate, onSaved }) {
  const [loaded, setLoaded] = useState(null); // { key, data } — data tagged with the entity it was fetched for
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Bumped after an edit is saved so the drawer re-reads the entity.
  const [reloadKey, setReloadKey] = useState(0);
  const lastEntityKeyRef = useRef(null);

  useEffect(() => {
    if (!entity) return;
    function handleKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [entity, onClose]);

  useEffect(() => {
    if (!entity) return;
    let cancelled = false;
    // Only a DIFFERENT entity clears what's shown; a re-read after a save keeps
    // the panel (and its "Saved" notice) on screen while the fresh data loads.
    const key = `${entity.level}:${entity.id}`;
    if (lastEntityKeyRef.current !== key) {
      setLoaded(null);
      lastEntityKeyRef.current = key;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- (re)starting a fetch, not a derived value
    setError(null);
    setLoading(true);
    fetch(`/api/fb/entity-details?level=${entity.level}&id=${encodeURIComponent(entity.id)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setLoaded({ key, data: json });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entity, reloadKey]);

  if (!entity) return null;

  // Navigating (e.g. ad -> its ad set) swaps `entity` one render before the
  // fetch effect above clears the previous entity's data; without this
  // check that render hands the old level's shape to the new level's
  // component (AdSetDetails reading `placements` off an ad's data crashed).
  const data = loaded && loaded.key === `${entity.level}:${entity.id}` ? loaded.data : null;
  const showLoading = !data && (loading || !error);

  const levelLabel = LEVEL_OPTIONS.find((l) => l.value === entity.level)?.label || "Entity";

  return (
    <div className={styles.drawerOverlay} onClick={onClose}>
      <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()} style={{ width: "min(560px, 100vw)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <p className={styles.muted} style={{ marginBottom: 2 }}>
              {levelLabel} setup
            </p>
            <h2 className={styles.h2}>{entity.name || entity.id}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={styles.btnSecondary} style={{ padding: 6 }}>
            <CloseIcon size={14} />
          </button>
        </div>

        {showLoading && !error && (
          <p className={styles.sub} style={{ marginTop: 20 }}>
            Loading…
          </p>
        )}
        {error && (
          <div className={styles.error} style={{ marginTop: 20 }}>
            {error}
          </div>
        )}

        {!showLoading && !error && data && (
          <div className={styles.dtStack} style={{ marginTop: 16 }}>
            {entity.level === "campaign" && (
              <CampaignDetailsPanel
                key={entity.id}
                campaignId={entity.id}
                data={data}
                onSaved={(result) => {
                  setReloadKey((k) => k + 1);
                  onSaved?.(entity, result);
                }}
              />
            )}
            {entity.level === "adset" && (
              <AdSetDetailsPanel
                key={entity.id}
                adsetId={entity.id}
                data={data}
                onNavigate={onNavigate}
                onSaved={(result) => {
                  setReloadKey((k) => k + 1);
                  onSaved?.(entity, result);
                }}
              />
            )}
            {entity.level === "ad" && (
              <AdDetailsPanel
                key={entity.id}
                adId={entity.id}
                data={data}
                onNavigate={onNavigate}
                onSaved={(result) => {
                  setReloadKey((k) => k + 1);
                  onSaved?.(entity, result);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
