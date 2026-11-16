import Head from "next/head";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import { googleAuthActive, isGoogleAdmin } from "@/lib/googleTest";
import { listIdentityLinks } from "@/lib/identityDb";
import { publicSession } from "@/lib/publicSession";
import Layout from "@/components/Layout";
import styles from "@/styles/Home.module.css";

const when = (iso) => (iso ? new Date(iso).toLocaleString() : "—");

// Who is signed in with which Google account on which Facebook login. Only for the admins (GOOGLE_AUTH_ADMINS).
export default function IdentityLinks({ configured, rows, error }) {
  const byFb = new Map();
  for (const r of rows) byFb.set(r.fb_user_id, (byFb.get(r.fb_user_id) || 0) + 1);
  return (
    <Layout>
      <Head>
        <title>Identity links · Facebook Auth Dashboard</title>
      </Head>
      <div className={styles.page}>
        <main className={styles.main}>
          <h1 className={styles.h1}>Identity links</h1>
          <p className={styles.sub}>Which Google account used which Facebook login .</p>
          {!configured && <p className={styles.error}>No database is connected: set DATABASE_URL.</p>}
          {error && <p className={styles.error}>{error}</p>}
          {configured && !error && rows.length === 0 && <p className={styles.muted}>Nothing linked yet. Sign in with Google and connect Facebook.</p>}
          {rows.length > 0 && (
            <div className={styles.card} style={{ overflowX: "auto" }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Google email</th>
                    <th>Facebook login</th>
                    <th>Facebook id</th>
                    <th>People on this login</th>
                    <th>Sign-ins</th>
                    <th>First linked</th>
                    <th>Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.google_email}:${r.fb_user_id}`}>
                      <td>{r.google_email}</td>
                      <td>{r.fb_name || r.fb_email || "—"}</td>
                      <td>{r.fb_user_id}</td>
                      <td>{byFb.get(r.fb_user_id)}</td>
                      <td>{r.sign_in_count}</td>
                      <td>{when(r.first_linked_at)}</td>
                      <td>{when(r.last_seen_at)}</td>
                    </tr>
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
  if (!googleAuthActive(context.req) || !session?.googleEmail || !isGoogleAdmin(session.googleEmail)) {
    return { redirect: { destination: "/", permanent: false } };
  }
  const { configured, rows, error } = await listIdentityLinks();
  return { props: { session: publicSession(session), configured, rows, error: error || null } };
}
