import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { signOut } from "next-auth/react";
import { useEffect, useState } from "react";
import { authOptions } from "./api/auth/[...nextauth]";
import styles from "@/styles/Home.module.css";

export default function Dashboard({ user }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/fb/data")
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch((err) => setError(err.message));
  }, []);

  return (
    <>
      <Head>
        <title>Dashboard · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main} style={{ width: "100%", maxWidth: 720 }}>
          <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
            <h1>Dashboard</h1>
            <button onClick={() => signOut({ callbackUrl: "/" })}>Sign out</button>
          </div>

          {error && <p style={{ color: "crimson" }}>Error: {error}</p>}
          {!data && !error && <p>Loading your Facebook data…</p>}

          {data && (
            <section style={{ width: "100%", display: "flex", flexDirection: "column", gap: 24 }}>
              <div>
                <h2>Profile</h2>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  {data.profile.picture?.data?.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={data.profile.picture.data.url}
                      alt={data.profile.name}
                      width={56}
                      height={56}
                      style={{ borderRadius: "50%" }}
                    />
                  )}
                  <div>
                    <p style={{ margin: 0, fontWeight: 600 }}>{data.profile.name}</p>
                    <p style={{ margin: 0, opacity: 0.7 }}>{data.profile.email || user?.email || "No email permission granted"}</p>
                  </div>
                </div>
              </div>

              <div>
                <h2>Pages ({data.pages.length})</h2>
                {data.pages.length === 0 ? (
                  <p style={{ opacity: 0.7 }}>No Pages found, or permission not granted.</p>
                ) : (
                  <ul>
                    {data.pages.map((page) => (
                      <li key={page.id}>
                        {page.name} <span style={{ opacity: 0.6 }}>({page.category})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h2>Ad Accounts ({data.adAccounts.length})</h2>
                {data.adAccounts.length === 0 ? (
                  <p style={{ opacity: 0.7 }}>No Ad Accounts found, or permission not granted.</p>
                ) : (
                  <ul>
                    {data.adAccounts.map((acc) => (
                      <li key={acc.id}>
                        {acc.name} <span style={{ opacity: 0.6 }}>({acc.currency}, status {acc.account_status})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session) {
    return { redirect: { destination: "/", permanent: false } };
  }

  return { props: { user: session.user || null } };
}
