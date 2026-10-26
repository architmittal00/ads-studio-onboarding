import { getServerSession } from "next-auth/next";
import type { GetServerSidePropsContext } from "next";
import { authOptions } from "./api/auth/[...nextauth]";
import CatalogAdsApp from "@/launch-ad/components/CatalogAdsApp";
import PageShell from "@/launch-ad/components/PageShell";

// sr-ads-launch's /catalog-ads screen inside this app's own shell — see PageShell.
export default function CatalogAdsNew() {
  return (
    <PageShell title="Catalog Ads (New)">
      <CatalogAdsApp declined={[]} />
    </PageShell>
  );
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) return { redirect: { destination: "/", permanent: false } };
  return { props: {} };
}
