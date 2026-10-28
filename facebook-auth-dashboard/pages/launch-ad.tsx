import { getServerSession } from "next-auth/next";
import type { GetServerSidePropsContext } from "next";
import { authOptions } from "./api/auth/[...nextauth]";
import { publicSession } from "@/lib/publicSession";
import LaunchApp from "@/launch-ad/components/LaunchApp";
import PageShell from "@/launch-ad/components/PageShell";

// sr-ads-launch's /launch screen inside this app's own shell — see PageShell.
export default function LaunchAd() {
  return (
    <PageShell title="Launch Ad">
      <LaunchApp declined={[]} />
    </PageShell>
  );
}

export async function getServerSideProps(context: GetServerSidePropsContext) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session) return { redirect: { destination: "/", permanent: false } };
  return { props: { session: publicSession(session) } };
}
