import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { Fragment, useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import Loader from "@/components/Loader";
import AccountSelect from "@/components/AccountSelect";
import { useAccounts } from "@/components/AccountProvider";
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
    <div style={{ position: "relative", maxWidth: 820 }}>
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
        <path d={area} fill="#4f8cff" opacity="0.12" />
        <path d={line} fill="none" stroke="#4f8cff" strokeWidth="2" strokeLinejoin="round" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--t2)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(points[hover])} r="4" fill="#4f8cff" stroke="var(--bg)" strokeWidth="2" />
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
            boxShadow: "0 4px 14px rgba(0,0,0,.18)",
          }}
        >
          <div style={{ color: "var(--t2)" }}>{granularity === "hour" ? new Date(labels[hover]).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }) : labelFor(labels[hover], granularity)}</div>
          <div style={{ fontWeight: 700 }}>{points[hover].toLocaleString("en-IN")} events</div>
        </div>
      )}
    </div>
  );
}

const RANGES = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7", label: "Last 7 days" },
  { key: "14", label: "Last 14 days" },
  { key: "30", label: "Last 30 days" },
  { key: "custom", label: "Custom" },
];

export default function PixelPage() {
  const { adAccounts, accountsLoading, selectedAccountId, setSelectedAccountId } = useAccounts();
  const [pixels, setPixels] = useState([]);
  const [pixelId, setPixelId] = useState("");
  const [pixelsLoading, setPixelsLoading] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);
  const [rangeKey, setRangeKey] = useState("7");
  const [custom, setCustom] = useState({ since: "", until: "" });
  const [appliedCustom, setAppliedCustom] = useState(null);

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
    if (!pixelId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the picked pixel's events
    setLoading(true);
    setError(null);
    const rangeQuery = rangeKey === "custom" ? (appliedCustom ? `&since=${appliedCustom.since}&until=${appliedCustom.until}` : null) : `&range=${rangeKey}`;
    if (!rangeQuery) {
      setLoading(false);
      return;
    }
    cachedGet(`/api/fb/pixel-events?pixelId=${pixelId}&accountId=${encodeURIComponent(selectedAccountId)}${rangeQuery}`)
      .then((json) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setData(json);
        setOpen(json.events?.[0]?.name ?? null);
      })
      .catch((err) => !cancelled && (setData(null), setError(err.message)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pixelId, selectedAccountId, rangeKey, appliedCustom]);

  const healthy = !!data?.pixel?.firing;

  return (
    <Layout>
      <Head>
        <title>Check your pixel · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1000, margin: "0 auto" }}>
          <h1 className={styles.h1}>Check your pixel</h1>
          <p className={styles.sub} style={{ marginBottom: 16 }}>
            Pick a pixel to see every event it received, when each last fired, and and how each trended over the date range you pick.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
            <AccountSelect accounts={adAccounts} value={selectedAccountId} onChange={setSelectedAccountId} style={{ minWidth: 260 }} loading={accountsLoading} />
            <select className={styles.select} value={pixelId} onChange={(e) => setPixelId(e.target.value)} disabled={pixels.length === 0} style={{ minWidth: 240 }}>
              {pixels.length === 0 && <option value="">{pixelsLoading ? "Loading pixels…" : "No pixels on this account"}</option>}
              {pixels.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.id})
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 18 }}>
            <div className={styles.tabGroup} role="radiogroup" aria-label="Date range">
              {RANGES.map((r) => (
                <button key={r.key} type="button" role="radio" aria-checked={rangeKey === r.key} className={rangeKey === r.key ? `${styles.tab} ${styles.tabActive}` : styles.tab} onClick={() => setRangeKey(r.key)}>
                  {r.label}
                </button>
              ))}
            </div>
            {rangeKey === "custom" && (
              <>
                <input type="date" className={styles.select} value={custom.since} max={custom.until || undefined} onChange={(e) => setCustom((c) => ({ ...c, since: e.target.value }))} />
                <span className={styles.muted}>to</span>
                <input type="date" className={styles.select} value={custom.until} min={custom.since || undefined} onChange={(e) => setCustom((c) => ({ ...c, until: e.target.value }))} />
                <button type="button" className={styles.btnPrimary} disabled={!custom.since || !custom.until || custom.since > custom.until} onClick={() => setAppliedCustom({ ...custom })}>
                  Apply
                </button>
              </>
            )}
            {data && <span className={styles.muted}>{data.range.since === data.range.until ? data.range.since : `${data.range.since} → ${data.range.until}`} · {data.timeZone}</span>}
          </div>

          {(pixelsLoading || loading) && <Loader label="Loading pixel events…" />}
          {error && <div className={styles.error}>{error}</div>}

          {data && !loading && (
            <>
              <div className={styles.card} style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{data.pixel.name}</div>
                  <div className={styles.muted} style={{ fontSize: 12 }}>
                    ID {data.pixel.id} · {data.timeZone}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={healthy ? styles.badgeInfo : styles.error} style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12 }}>
                    {data.pixel.lastFiredTime ? (healthy ? "Firing" : "Not fired in 24h+") : "Never fired"}
                  </span>
                  <div className={styles.muted} style={{ fontSize: 12, marginTop: 4 }}>
                    Last fired {exactTime(data.pixel.lastFiredTime)} ({ago(data.pixel.lastFiredTime)})
                  </div>
                </div>
              </div>

              {data.events.length > 0 && (
                <p className={styles.muted} style={{ fontSize: 12, marginBottom: 8 }}>
                  Times are in your time zone. Meta reports events per hour, so an event&apos;s last-fired time is the start of the hour it last fired in; the pixel&apos;s own last-fired time above is exact. Counts are browser + server events, with days in {data.timeZone}. Recent hours can run up to an hour behind Events Manager, since Meta&apos;s hourly stats lag. The chart is hourly for a range of up to 2 days, daily beyond that.
                </p>
              )}
              {data.events.length === 0 ? (
                <div className={styles.card}>
                  <p style={{ fontWeight: 700, marginBottom: 4 }}>No events in this date range</p>
                  <p className={styles.sub}>This pixel hasn&apos;t received any events recently — check that it&apos;s installed on your site.</p>
                </div>
              ) : (
                <div className={styles.card} style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--t2)" }}>
                        <th style={{ padding: "8px 10px" }}>Event</th>
                        <th style={{ padding: "8px 10px" }}>Last fired</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Events in range</th>
                        <th style={{ padding: "8px 10px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => (
                        <Fragment key={e.name}>
                          <tr style={{ borderTop: "1px solid var(--border)" }}>
                            <td style={{ padding: "10px", fontWeight: 600 }}>{e.name}</td>
                            <td style={{ padding: "10px" }}>
                              {exactTime(e.lastFired)}
                              <div className={styles.muted} style={{ fontSize: 11.5 }}>
                                {ago(e.lastFired)}
                              </div>
                            </td>
                            <td style={{ padding: "10px", textAlign: "right" }}>{e.total.toLocaleString("en-IN")}</td>
                            <td style={{ padding: "10px", textAlign: "right" }}>
                              <button type="button" className={styles.btnSecondary} style={{ padding: "5px 12px" }} onClick={() => setOpen(open === e.name ? null : e.name)}>
                                {open === e.name ? "Hide trend" : "View trend"}
                              </button>
                            </td>
                          </tr>
                          {open === e.name && (
                            <tr>
                              <td colSpan={4} style={{ padding: "6px 10px 16px" }}>
                                <Trend labels={data.labels} points={e.points} granularity={data.granularity} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
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
