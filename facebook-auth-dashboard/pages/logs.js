import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { Fragment, useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import styles from "@/styles/Home.module.css";

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  function load() {
    setLoading(true);
    fetch("/api/logs")
      .then((res) => res.json())
      .then((json) => setLogs(json.logs || []))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    // `loading` already starts true, so the initial fetch skips load()'s
    // synchronous setLoading(true) call.
    fetch("/api/logs")
      .then((res) => res.json())
      .then((json) => setLogs(json.logs || []))
      .finally(() => setLoading(false));
  }, []);

  function clear() {
    fetch("/api/logs", { method: "DELETE" }).then(load);
  }

  return (
    <Layout>
      <Head>
        <title>API Logs · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div className={styles.sectionRow}>
            <h1 className={styles.h1}>API Logs</h1>
            <div style={{ display: "flex", gap: 8 }}>
              <button className={styles.btnSecondary} onClick={load}>
                Refresh
              </button>
              <button className={styles.btnSecondary} onClick={clear}>
                Clear
              </button>
            </div>
          </div>

          <p className={styles.sub} style={{ marginBottom: 16 }}>
            Shows the most recent Graph API requests made by this server instance (resets on cold start or
            redeploy). Click a row to see the full request URL and response. For a permanent record, check the
            Function Logs for this project in the Vercel dashboard.
          </p>

          {loading && <p className={styles.sub}>Loading…</p>}
          {!loading && logs.length === 0 && <p className={styles.sub}>No API calls logged yet.</p>}

          {logs.length > 0 && (
            <div className={styles.card} style={{ overflowX: "auto" }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Method</th>
                    <th>Path</th>
                    <th>Status</th>
                    <th>Duration</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <Fragment key={log.id}>
                      <tr
                        style={{ cursor: "pointer" }}
                        onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                      >
                        <td>{new Date(log.timestamp).toLocaleTimeString()}</td>
                        <td>
                          <span className={log.method === "POST" ? styles.badgeWarn : styles.badgeInfo}>
                            {log.method || "GET"}
                          </span>
                        </td>
                        <td style={{ fontFamily: "monospace", fontSize: 11 }}>{log.path}</td>
                        <td>
                          <span className={log.error ? styles.badgeDanger : styles.badgeGood}>
                            {log.status ?? "ERR"}
                          </span>
                        </td>
                        <td>{log.durationMs}ms</td>
                        <td style={{ color: "var(--red)", fontSize: 11 }}>{log.error || "—"}</td>
                      </tr>
                      {expandedId === log.id && (
                        <tr>
                          <td colSpan={6}>
                            <p className={styles.muted} style={{ marginBottom: 6 }}>
                              URL
                            </p>
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                fontSize: 11,
                                color: "var(--t2)",
                                marginBottom: 10,
                              }}
                            >
                              {log.url}
                            </pre>
                            <p className={styles.muted} style={{ marginBottom: 6 }}>
                              Response
                            </p>
                            <pre
                              style={{
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-all",
                                fontSize: 11,
                                color: "var(--t2)",
                              }}
                            >
                              {log.responsePreview || "(no response body captured)"}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>
    </Layout>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: {} };
}
