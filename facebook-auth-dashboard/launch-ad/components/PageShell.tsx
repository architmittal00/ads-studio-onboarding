import type { ReactNode } from "react";
import Head from "next/head";
import Layout from "@/components/Layout";
import ApiLogPanel from "@/launch-ad/components/ApiLogPanel";
import { toggleLog, useApiLog } from "@/launch-ad/lib/api-log";
import styles from "@/styles/Home.module.css";

// Our wrapper (not part of the sr-ads-launch clone): renders a cloned screen inside
// this app's Layout/Sidebar, with the clone's CSS scoped under `.la-root` and its
// API log toggle (originally in sr-ads-launch's own top bar) above the screen.
export default function PageShell({ title, children }: { title: string; children: ReactNode }) {
  const log = useApiLog();
  const errors = log.groups.filter((g) => !g.ok || g.calls.some((c) => !c.ok)).length;
  return (
    <Layout>
      <Head>
        <title>{title} · Facebook Auth Dashboard</title>
      </Head>
      <div className="la-root">
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 20px 0" }}>
          <button type="button" className={styles.btnSecondary} onClick={toggleLog} aria-pressed={log.open}>
            API log{errors ? ` (${errors} with errors)` : ""}
          </button>
        </div>
        {children}
        <ApiLogPanel />
      </div>
    </Layout>
  );
}
