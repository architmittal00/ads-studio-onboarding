import type { ReactNode } from "react";
import Head from "next/head";
import Layout from "@/components/Layout";

// Our wrapper (not part of the sr-ads-launch clone): renders a cloned screen inside
// this app's Layout/Sidebar, with the clone's CSS scoped under `.la-root`. The clone's
// own API-log drawer is intentionally not mounted — this app has its own /logs.
export default function PageShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Layout>
      <Head>
        <title>{title} · Facebook Auth Dashboard</title>
      </Head>
      <div className="la-root">{children}</div>
    </Layout>
  );
}
