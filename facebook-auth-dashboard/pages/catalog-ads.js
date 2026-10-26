import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import Layout from "@/components/Layout";
import PinGate from "@/components/catalogads/PinGate";
import { TagIcon } from "@/components/icons";
import { isCatalogAdsUnlocked } from "@/lib/catalogAds/requirePin";
import styles from "@/styles/Home.module.css";

// Phase 1 scaffold only (see PROJECT_STATUS.md / the Catalog Ads plan):
// just the PIN gate and nav entry land here. Overview / My Catalog Ads /
// Product Sets / Create Ad are filled in by the phases that follow, each its
// own PR — this placeholder is what a successful unlock reveals until then.
export default function CatalogAdsPage({ unlocked }) {
  return (
    <Layout>
      <Head>
        <title>Catalog Ads · Facebook Auth Dashboard</title>
      </Head>
      {unlocked ? (
        <div className={styles.page}>
          <div className={styles.main}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <TagIcon size={20} />
              <h1 className={styles.h1}>Catalog Ads</h1>
            </div>
            <p className={styles.sub}>
              This section is under construction — catalog performance, product sets, and a guided ad-launch wizard
              are coming in upcoming rounds.
            </p>
          </div>
        </div>
      ) : (
        <PinGate />
      )}
    </Layout>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: { unlocked: isCatalogAdsUnlocked(context.req) } };
}
