import Head from "next/head";
import { getServerSession } from "next-auth/next";
import type { GetServerSidePropsContext } from "next";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import LaunchApp from "@/launch-ad/components/LaunchApp";
import ApiLogPanel from "@/launch-ad/components/ApiLogPanel";
import { toggleLog, useApiLog } from "@/launch-ad/lib/api-log";
import styles from "@/styles/Home.module.css";

// sr-ads-launch's /launch screen, rendered inside this app's own shell
// (Layout/Sidebar). Its CSS is scoped under `.la-root` (launch-ad/launch-ad.scoped.css,
// loaded from _app.js) and mapped onto this app's design tokens.
export default function LaunchAd() {
  const log = useApiLog();
  const errors = log.groups.filter((g) => !g.ok || g.calls.some((c) => !c.ok)).length;
  return (
    <Layout>
      <Head>
        <title>Launch Ad · Facebook Auth Dashboard</title>
      </Head>
      <div className="la-root">
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "12px 20px 0" }}>
          <button type="button" className={styles.btnSecondary} onClick={toggleLog} aria-pressed={log.open}>
            API log{errors ? ` (${errors} with errors)` : ""}
          </button>
        </div>
        <LaunchApp declined={[]} />
        <ApiLogPanel />
      </div>
    </Layout>
  );
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) return { redirect: { destination: "/", permanent: false } };
  return { props: {} };
}
