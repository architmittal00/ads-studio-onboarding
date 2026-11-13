import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { useMemo, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import ViewTabs from "@/components/ViewTabs";
import MonitorAccountTab from "@/components/monitor/MonitorAccountTab";
import { useAccounts } from "@/components/AccountProvider";
import { useMonitor } from "@/lib/monitorStore";
import styles from "@/styles/Home.module.css";

export default function Monitor() {
  return (
    <Layout>
      <Head>
        <title>Monitor · Facebook Auth Dashboard</title>
      </Head>
      <MonitorContent />
    </Layout>
  );
}

// The campaigns, ad sets and ads marked "Monitor" in Custom Views or Recommendations, one tab per ad account.
function MonitorContent() {
  const monitor = useMonitor();
  const { adAccounts, accountsLoading } = useAccounts();
  const [activeId, setActiveId] = useState(null);

  const byAccount = useMemo(() => {
    const map = new Map();
    for (const item of monitor.items) {
      if (!map.has(item.accountId)) map.set(item.accountId, []);
      map.get(item.accountId).push(item);
    }
    return map;
  }, [monitor.items]);
  const accountIds = [...byAccount.keys()];
  const current = accountIds.includes(activeId) ? activeId : accountIds[0];
  const accountName = (id) => adAccounts.find((a) => a.id === id)?.name || id;

  return (
    <div className={styles.page}>
      <main className={styles.main} style={{ maxWidth: 1600, margin: "0 auto", minWidth: 0 }}>
        <div>
          <h1 className={styles.h1}>Monitor</h1>
          <p className={styles.sub}>
            Campaigns, ad sets and ads you want to keep an eye on without acting yet. Add them with <strong>Add to monitor</strong> in Custom Views, or <strong>+ Monitor</strong> on a recommendation.
          </p>
        </div>

        {!monitor.ready ? null : accountIds.length === 0 ? (
          <div className={styles.card} style={{ padding: 24 }}>
            <h2 className={styles.h2} style={{ marginBottom: 6 }}>
              Nothing monitored yet
            </h2>
            <p className={styles.sub} style={{ margin: 0 }}>
              In Custom Views, open the ⋯ menu on a campaign, ad set or ad and choose <strong>Add to monitor</strong>. On Recommendations, use <strong>+ Monitor</strong> on a card. Everything you add shows up here, one tab per ad account, with its performance, recommendations and the same actions you have in Custom Views.
            </p>
          </div>
        ) : (
          <>
            <ViewTabs
              sticky={false}
              tabs={accountIds.map((id) => ({ id, title: `${accountName(id)} · ${byAccount.get(id).length}` }))}
              activeId={current}
              onSelect={setActiveId}
            />
            <MonitorAccountTab
              key={current}
              accountId={current}
              account={adAccounts.find((a) => a.id === current) || null}
              accountsLoading={accountsLoading}
              items={byAccount.get(current)}
              prefs={monitor.prefs[current] || {}}
              onRemove={monitor.remove}
              onPrefs={(patch) => monitor.setPrefs(current, patch)}
              isMonitored={monitor.isMonitored}
            />
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
