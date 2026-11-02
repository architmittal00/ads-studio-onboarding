import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useEffect, useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import SortableTable from "@/components/SortableTable";
import { RefreshIcon, PixelIcon } from "@/components/icons";
import AccountSelect from "@/components/AccountSelect";
import { useAccounts } from "@/components/AccountProvider";
import DateRangeMenu from "@/components/DateRangeMenu";
import { computeRange } from "@/lib/dateRanges";
import { cachedGet } from "@/lib/cachedGet";
import styles from "@/styles/Home.module.css";

function ago(iso) {
  if (!iso) return "Never";
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

// Exact date and time in the viewer's own time zone, e.g. "2 Nov 2026, 3:42 pm IST".
function exactTime(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZoneName: "short" });
}

const compact = (n) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}K` : String(Math.round(n)));

function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const m = v / pow;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * pow;
}

function labelFor(label, granularity) {
  if (granularity === "hour") {
    return new Date(label).toLocaleString("en-IN", { weekday: "short", hour: "numeric", hour12: true });
  }
  return new Date(`${label}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

// Area line chart like Events Manager's "Event volume": gridlines, axis labels, hover readout.
function Trend({ labels, points, granularity }) {
  const [hover, setHover] = useState(null);
  const W = 760;
  const H = 230;
  const L = 46;
  const R = 12;
  const T = 14;
  const B = 28;
  const max = niceMax(Math.max(...points));
  const n = points.length;
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i / (n - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const line = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const xCount = Math.min(n, 6);
  const xIdx = Array.from({ length: xCount }, (_, k) => (xCount === 1 ? 0 : Math.round((k / (xCount - 1)) * (n - 1))));

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1)))));
  }

  return (
    <div style={{ position: "relative", }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Event volume over the selected range" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(max * t)} y2={y(max * t)} stroke="var(--border)" strokeWidth="1" />
            <text x={L - 8} y={y(max * t) + 3.5} textAnchor="end" fontSize="11" fill="var(--t2)">
              {compact(max * t)}
            </text>
          </g>
        ))}
        {xIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="11" fill="var(--t2)">
            {labelFor(labels[i], granularity)}
          </text>
        ))}
        <path d={area} style={{ fill: "var(--purple)" }} opacity="0.12" />
        <path d={line} fill="none" style={{ stroke: "var(--purple)" }} strokeWidth="2" strokeLinejoin="round" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--t2)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover])} r="4" style={{ fill: "var(--purple)", stroke: "var(--bg)" }} strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: `${(x(hover) / W) * 100}%`,
            transform: `translateX(${hover > n / 2 ? "-105%" : "5%"})`,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 12,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            boxShadow: "var(--shadow-md)",
          }}
        >
          <div style={{ color: "var(--t2)" }}>{granularity === "hour" ? new Date(labels[hover]).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : labelFor(labels[hover], granularity)}</div>
          <div style={{ fontWeight: 700 }}>{points[hover].toLocaleString("en-IN")} events</div>
        </div>
      )}
    </div>
  );
}

function Sparkline({ points }) {
  const max = Math.max(1, ...points);
  const n = points.length;
  if (n < 2) return null;
  const d = points.map((v, i) => `${i ? "L" : "M"}${((i / (n - 1)) * 100).toFixed(1)},${(22 - (v / max) * 20).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" style={{ width: 110, height: 26, display: "block", marginLeft: "auto" }} aria-hidden="true">
      <path d={d} fill="none" style={{ stroke: "var(--purple)" }} strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function LabeledPill({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span className={styles.muted} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {label}
      </span>
      {children}
    </div>
  );
}

export default function PixelPage() {
  const { adAccounts, accountsLoading, selectedAccountId, setSelectedAccountId } = useAccounts();
  const [pixels, setPixels] = useState([]);
  const [pixelId, setPixelId] = useState("");
  const [pixelsLoading, setPixelsLoading] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [picked, setPicked] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [rangePreset, setRangePreset] = useState("last_7d");
  const [customSince, setCustomSince] = useState("");
  const [customUntil, setCustomUntil] = useState("");
  const timeZone = adAccounts.find((a) => a.id === selectedAccountId)?.timezone_name;
  const range = useMemo(() => computeRange(rangePreset, customSince, customUntil, timeZone), [rangePreset, customSince, customUntil, timeZone]);

  useEffect(() => {
    if (!selectedAccountId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the page for the newly picked account
    setPixelsLoading(true);
    setPixels([]);
    setPixelId("");
    setData(null);
    setError(null);
    cachedGet(`/api/fb/pixels?accountId=${encodeURIComponent(selectedAccountId)}`)
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setPixels(json.pixels || []);
        if (json.pixels?.length) setPixelId(json.pixels[0].id);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setPixelsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedAccountId]);

  useEffect(() => {
    if (!pixelId || !range) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the picked pixel's events
    setLoading(true);
    setError(null);
    cachedGet(`/api/fb/pixel-events?pixelId=${pixelId}&accountId=${encodeURIComponent(selectedAccountId)}&since=${range.since}&until=${range.until}`, { force: reloadKey > 0 })
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch((err) => !cancelled && (setData(null), setError(err.message)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pixelId, selectedAccountId, range, reloadKey]);

  const events = data?.events;
  // The chart follows the picked event, falling back to the busiest one.
  const current = events?.find((e) => e.name === picked) || events?.[0] || null;
  const totalEvents = events ? events.reduce((sum, e) => sum + e.total, 0) : 0;
  const rows = useMemo(() => events || [], [events]);
  const firing = !!data?.pixel?.firing;

  return (
    <Layout>
      <Head>
        <title>Check your pixel · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h1 className={styles.h1} style={{ margin: 0 }}>
                Check your pixel
              </h1>
              <p className={styles.sub} style={{ marginTop: 6 }}>
                See every event your pixel received, when each last fired, and how it trended.
              </p>
            </div>
            <div className={styles.headerPillRow} style={{ alignItems: "flex-end" }}>
              <LabeledPill label="Ad Account">
                <AccountSelect
                  accounts={adAccounts}
                  value={selectedAccountId}
                  onChange={setSelectedAccountId}
                  placeholder="Select an ad account…"
                  inputClassName={styles.headerPillSelect}
                  inputStyle={{ width: 190 }}
                  loading={accountsLoading}
                />
              </LabeledPill>
              <LabeledPill label="Pixel">
                <select className={`${styles.select} ${styles.headerPillSelect}`} style={{ width: 190 }} value={pixelId} onChange={(e) => setPixelId(e.target.value)} disabled={pixels.length === 0}>
                  {pixels.length === 0 && <option value="">{pixelsLoading ? "Loading pixels…" : "No pixels on this account"}</option>}
                  {pixels.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </LabeledPill>
              <DateRangeMenu
                timeZone={timeZone}
                rangePreset={rangePreset}
                customSince={customSince}
                customUntil={customUntil}
                maxRangeDays={31}
                compareToPrevious={false}
                compareCustomSince=""
                compareDisplay="change"
                compareDisabled
                compareDisabledReason="Not available here — this page shows one window at a time."
                triggerClassName={styles.headerPillBtn}
                onApply={(patch) => {
                  setRangePreset(patch.rangePreset);
                  setCustomSince(patch.customSince);
                  setCustomUntil(patch.customUntil);
                }}
              />
              <button
                type="button"
                className={loading ? `${styles.headerPillIconBtn} spinning` : styles.headerPillIconBtn}
                onClick={() => setReloadKey((k) => k + 1)}
                disabled={!pixelId || loading}
                title="Reload"
                aria-label="Reload"
              >
                <RefreshIcon size={14} />
              </button>
            </div>
          </div>

          {error && <div className={styles.error}>{error}</div>}

          {!selectedAccountId || (!pixelsLoading && pixels.length === 0 && !error) ? (
            <section className={styles.card}>
              <div className={styles.exploreEmptyState}>
                <div className={styles.exploreEmptyIcon}>
                  <PixelIcon size={26} />
                </div>
                <div>
                  <h2 className={styles.h2} style={{ marginBottom: 6 }}>
                    {selectedAccountId ? "No pixel on this ad account" : "Pick an ad account"}
                  </h2>
                  <p className={styles.sub}>{selectedAccountId ? "Create a pixel in Events Manager, or choose another ad account." : "Choose an ad account above to see its pixel and the events it received."}</p>
                </div>
              </div>
            </section>
          ) : null}

          {(pixelsLoading || (loading && !data)) && <Loader label="Loading pixel events…" />}

          {data && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, opacity: loading ? 0.5 : 1, transition: "opacity .15s" }}>
              <div className={styles.statBar}>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>Pixel</div>
                  <div className={styles.statValue} style={{ fontSize: 15, marginBottom: 6 }}>
                    {data.pixel.name}
                  </div>
                  <span className={data.pixel.lastFiredTime ? (firing ? styles.badgeGood : styles.badgeWarn) : styles.badgeDanger}>{data.pixel.lastFiredTime ? (firing ? "Firing" : "Not fired in 24h+") : "Never fired"}</span>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>Last fired</div>
                  <div className={styles.statValue} style={{ fontSize: 15 }}>
                    {ago(data.pixel.lastFiredTime)}
                  </div>
                  <div className={styles.muted} style={{ marginTop: 4 }}>
                    {exactTime(data.pixel.lastFiredTime)}
                  </div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>Events in range</div>
                  <div className={styles.statValue}>{compact(totalEvents)}</div>
                  <div className={styles.muted} style={{ marginTop: 4 }}>
                    {data.range.since === data.range.until ? data.range.since : `${data.range.since} → ${data.range.until}`}
                  </div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>Event types</div>
                  <div className={styles.statValue}>{events.length}</div>
                  <div className={styles.muted} style={{ marginTop: 4 }}>
                    Top: {events[0]?.name || "—"}
                  </div>
                </div>
              </div>

              {events.length === 0 ? (
                <section className={styles.card}>
                  <div className={styles.exploreEmptyState}>
                    <div className={styles.exploreEmptyIcon}>
                      <PixelIcon size={26} />
                    </div>
                    <div>
                      <h2 className={styles.h2} style={{ marginBottom: 6 }}>
                        No events in this date range
                      </h2>
                      <p className={styles.sub}>This pixel hasn&apos;t received any events in this window. Try a wider range, or check that it&apos;s installed on your site.</p>
                    </div>
                  </div>
                </section>
              ) : (
                <>
                  <section className={styles.card}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                      <div>
                        <h2 className={styles.h2} style={{ marginBottom: 2 }}>
                          {current.name}
                        </h2>
                        <p className={styles.sub}>
                          {current.total.toLocaleString("en-IN")} events · last fired {exactTime(current.lastFired)}
                        </p>
                      </div>
                      <div className={styles.tabGroup} role="radiogroup" aria-label="Event">
                        {events.slice(0, 8).map((e) => (
                          <button key={e.name} type="button" role="radio" aria-checked={e.name === current.name} className={e.name === current.name ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setPicked(e.name)}>
                            {e.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <Trend labels={data.labels} points={current.points} granularity={data.granularity} />
                  </section>

                  <section className={styles.card}>
                    <h2 className={styles.h2} style={{ marginBottom: 12 }}>
                      All events
                    </h2>
                    <SortableTable
                      defaultSortKey="total"
                      maxHeight={520}
                      rows={rows}
                      rowKey={(r) => r.name}
                      searchable={rows.length > 8}
                      searchKeys={["name"]}
                      searchPlaceholder="Search events…"
                      onRowClick={(r) => setPicked(r.name)}
                      highlightRow={(r) => r.name === current.name}
                      columns={[
                        { key: "name", label: "Event" },
                        {
                          key: "lastFired",
                          label: "Last fired",
                          render: (r) => (
                            <>
                              {exactTime(r.lastFired)} <span className={styles.muted}>· {ago(r.lastFired)}</span>
                            </>
                          ),
                        },
                        { key: "total", label: "Events", align: "right", render: (r) => r.total.toLocaleString("en-IN") },
                        { key: "points", label: "Trend", align: "right", sortValue: (r) => r.total, render: (r) => <Sparkline points={r.points} /> },
                      ]}
                    />
                    <p className={styles.muted} style={{ marginTop: 10, fontWeight: 400 }}>
                      Times are in your time zone. Meta reports events per hour, so an event&apos;s last-fired time is the start of its last hour; the pixel&apos;s own last-fired time is exact. Counts include browser + server events, with days in {data.timeZone}. The latest hour can trail Events Manager. Charts are hourly for up to 2 days, daily beyond that. Click a row to chart it.
                    </p>
                  </section>
                </>
              )}
            </div>
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
