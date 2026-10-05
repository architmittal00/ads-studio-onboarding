import Head from "next/head";
import { getSession, signIn, useSession } from "next-auth/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import styles from "@/styles/Home.module.css";

export default function Home() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  return (
    <>
      <Head>
        <title>Facebook Auth Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className={styles.page}>
        <main
          className={styles.main}
          style={{ alignItems: "center", textAlign: "center" }}
        >
          <h1>Facebook Auth Dashboard</h1>
          <p>Sign in with Facebook to view your profile, Pages, and Ad Accounts.</p>
          <button
            onClick={() => signIn("facebook", { callbackUrl: "/dashboard" })}
            style={{
              background: "#1877F2",
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "12px 24px",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Continue with Facebook
          </button>
        </main>
      </div>
    </>
  );
}

export async function getServerSideProps(context) {
  const session = await getSession(context);
  if (session) {
    return { redirect: { destination: "/dashboard", permanent: false } };
  }
  return { props: {} };
}
