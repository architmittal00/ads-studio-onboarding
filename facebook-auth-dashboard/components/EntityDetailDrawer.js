import { useEffect, useState } from "react";
import { CloseIcon } from "./icons";
import { LEVEL_OPTIONS } from "@/lib/insightsMetrics";
import styles from "@/styles/Home.module.css";

// Read-only "how is this actually set up" drawer for one Campaign/Ad Set/Ad
// row in Explore — deliberately a side drawer (components/EntityChangesDrawer.js's
// own .drawerOverlay/.drawerPanel convention), never a navigation elsewhere:
// this is about understanding a row without losing your place in the table.
// `entity` is `{ level: "campaign"|"adset"|"ad", id, name }`; data for each
// level comes from /api/fb/entity-details (see lib/entityDetails.js for what
// each level actually fetches/resolves).
export default function EntityDetailDrawer({ entity, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets stale data/error from a previously-opened row, not derivable from props/state
    setData(null);
    setError(null);
    setLoading(true);
    fetch(`/api/fb/entity-details?level=${entity.level}&id=${encodeURIComponent(entity.id)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setData(json);
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
  }, [entity]);

  if (!entity) return null;

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

        {loading && (
          <p className={styles.sub} style={{ marginTop: 20 }}>
            Loading…
          </p>
        )}
        {error && (
          <div className={styles.error} style={{ marginTop: 20 }}>
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 20 }}>
            {entity.level === "campaign" && <CampaignDetails data={data} />}
            {entity.level === "adset" && <AdSetDetails data={data} />}
            {entity.level === "ad" && <AdDetails adId={entity.id} data={data} />}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, children }) {
  return (
    <div>
      <p className={styles.muted} style={{ marginBottom: 6 }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function PillList({ items, emptyLabel = "—" }) {
  if (!items || items.length === 0) {
    return <p className={styles.sub}>{emptyLabel}</p>;
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((item, i) => (
        <span key={`${item}-${i}`} className={styles.pill}>
          {item}
        </span>
      ))}
    </div>
  );
}

function TextVariantList({ items }) {
  if (!items || items.length === 0) return <p className={styles.sub}>—</p>;
  if (items.length === 1) {
    return (
      <p className={styles.sub} style={{ whiteSpace: "pre-wrap" }}>
        {items[0]}
      </p>
    );
  }
  return (
    <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((text, i) => (
        <li key={i} className={styles.sub} style={{ whiteSpace: "pre-wrap" }}>
          {text}
        </li>
      ))}
    </ol>
  );
}

function CampaignDetails({ data }) {
  return (
    <DetailRow label="Objective">
      <p className={styles.sub} style={{ fontSize: 15, fontWeight: 600, color: "var(--t1)" }}>
        {data.objective || "—"}
      </p>
    </DetailRow>
  );
}

function AdSetDetails({ data }) {
  return (
    <>
      <DetailRow label="Locations">
        <PillList items={data.locations} />
        {data.excludedLocations && (
          <div style={{ marginTop: 8 }}>
            <p className={styles.muted} style={{ marginBottom: 6, fontSize: 11 }}>
              Excluded
            </p>
            <PillList items={data.excludedLocations} />
          </div>
        )}
      </DetailRow>

      <DetailRow label="Interests">
        <PillList items={data.interests} emptyLabel={data.advantageAudience ? "Advantage+ Audience (no manual interests)" : "Broad — no detailed targeting"} />
      </DetailRow>

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <DetailRow label="Age">
          <p className={styles.sub}>{data.ageRange}</p>
        </DetailRow>
        <DetailRow label="Gender">
          <p className={styles.sub}>{data.genders}</p>
        </DetailRow>
      </div>

      <DetailRow label="Language">
        <PillList items={data.languages} emptyLabel="All languages" />
      </DetailRow>

      <DetailRow label="Placement">
        {data.placements.automatic ? (
          <p className={styles.sub}>Advantage+ Placements (automatic)</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <PillList items={data.placements.platforms} />
            {data.placements.facebookPositions?.length > 0 && (
              <p className={styles.sub} style={{ fontSize: 12 }}>
                Facebook: {data.placements.facebookPositions.join(", ")}
              </p>
            )}
            {data.placements.instagramPositions?.length > 0 && (
              <p className={styles.sub} style={{ fontSize: 12 }}>
                Instagram: {data.placements.instagramPositions.join(", ")}
              </p>
            )}
          </div>
        )}
      </DetailRow>
    </>
  );
}

function AdDetails({ adId, data }) {
  return (
    <>
      <DetailRow label="Primary Text">
        <TextVariantList items={data.primaryTexts} />
      </DetailRow>
      <DetailRow label="Headlines">
        <TextVariantList items={data.headlines} />
      </DetailRow>
      <DetailRow label="Descriptions">
        <TextVariantList items={data.descriptions} />
      </DetailRow>
      <DetailRow label="CTA">
        <PillList items={data.ctaLabel ? [data.ctaLabel] : null} />
      </DetailRow>
      <DetailRow label="Preview">
        <AdPreview adId={adId} />
      </DetailRow>
    </>
  );
}

// Inline version of CreativeLightbox's own live-preview fetch — rendered
// right in the drawer instead of a separate fullscreen popup, per the "keep
// this all in one side drawer" requirement. Deliberately not sharing code
// with CreativeLightbox: that component also handles a native-video-file
// fast path (pages/report.js's own resolved videoUrl) that Explore's rows
// never carry, so reusing it here would mean passing it data it can't use.
function AdPreview({ adId }) {
  const [preview, setPreview] = useState({ loading: true, url: null, error: null });

  useEffect(() => {
    let cancelled = false;
    // Kicks off an async fetch (which itself sets loading/error/result
    // state) — intentional, not a derived-state anti-pattern. Mirrors
    // CreativeLightbox's own identical preview-fetch effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview({ loading: true, url: null, error: null });
    fetch(`/api/fb/ad-preview?adId=${encodeURIComponent(adId)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        setPreview({ loading: false, url: json.previewUrl || null, error: json.previewUrl ? null : json.error || json.warning });
      })
      .catch((err) => {
        if (!cancelled) setPreview({ loading: false, url: null, error: err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [adId]);

  if (preview.loading) return <p className={styles.sub}>Loading preview…</p>;
  if (preview.url) {
    return (
      <iframe
        src={preview.url}
        width={340}
        height={480}
        allow="autoplay; encrypted-media"
        sandbox="allow-scripts allow-same-origin allow-popups"
        style={{ maxWidth: "100%", border: "1px solid var(--border)", borderRadius: 10 }}
      />
    );
  }
  return <p className={styles.sub}>{preview.error || "No live preview available for this ad."}</p>;
}
