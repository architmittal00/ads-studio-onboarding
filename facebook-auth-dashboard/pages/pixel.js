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

function Trend({ days, daily }) {
  const max = Math.max(1, ...daily);
  const W = 420;
  const H = 110;
  const bw = W / daily.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} style={{ width: "100%", maxWidth: 520, height: "auto" }} role="img" aria-label="Events per day, last 7 days">
      {daily.map((v, i) => {
        const h = (v / max) * H;
        return (
          <g key={days[i]}>
            <rect x={i * bw + 8} y={H - h} width={bw - 16} height={h} rx={3} fill="var(--accent, #4f8cff)" opacity={0.85} />
            <text x={i * bw + bw / 2} y={Math.max(10, H - h - 4)} textAnchor="middle" fontSize="10" fill="var(--t2)">
              {v.toLocaleString("en-IN")}
            </text>
            <text x={i * bw + bw / 2} y={H + 15} textAnchor="middle" fontSize="10" fill="var(--t2)">
              {days[i].slice(5)}
            </text>
          </g>
        );
      })}
    </svg>
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
  const [open, setOpen] = useState(null);

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
    setOpen(null);
    cachedGet(`/api/fb/pixel-events?pixelId=${pixelId}&accountId=${encodeURIComponent(selectedAccountId)}`)
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
  }, [pixelId, selectedAccountId]);

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
            Pick a pixel to see every event it received in the last 7 days, when each last fired, and how each trended day by day.
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

          {(pixelsLoading || loading) && <Loader label="Loading pixel events…" />}
          {error && <div className={styles.error}>{error}</div>}

          {data && !loading && (
            <>
              <div className={styles.card} style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{data.pixel.name}</div>
                  <div className={styles.muted} style={{ fontSize: 12 }}>
                    ID {data.pixel.id} · days in {data.timeZone}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <span className={healthy ? styles.badgeInfo : styles.error} style={{ padding: "3px 10px", borderRadius: 999, fontSize: 12 }}>
                    {data.pixel.lastFiredTime ? (healthy ? "Firing" : "Not fired in 24h+") : "Never fired"}
                  </span>
                  <div className={styles.muted} style={{ fontSize: 12, marginTop: 4 }}>
                    Last fired {ago(data.pixel.lastFiredTime)}
                  </div>
                </div>
              </div>

              {data.events.length === 0 ? (
                <div className={styles.card}>
                  <p style={{ fontWeight: 700, marginBottom: 4 }}>No events in the last 7 days</p>
                  <p className={styles.sub}>This pixel hasn&apos;t received any events recently — check that it&apos;s installed on your site.</p>
                </div>
              ) : (
                <div className={styles.card} style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ textAlign: "left", color: "var(--t2)" }}>
                        <th style={{ padding: "8px 10px" }}>Event</th>
                        <th style={{ padding: "8px 10px" }}>Last fired</th>
                        <th style={{ padding: "8px 10px", textAlign: "right" }}>Events (7 days)</th>
                        <th style={{ padding: "8px 10px" }} />
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => (
                        <Fragment key={e.name}>
                          <tr style={{ borderTop: "1px solid var(--border)" }}>
                            <td style={{ padding: "10px", fontWeight: 600 }}>{e.name}</td>
                            <td style={{ padding: "10px" }} title={new Date(e.lastFired).toLocaleString()}>
                              {ago(e.lastFired)}
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
                                <Trend days={data.days} daily={e.daily} />
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
