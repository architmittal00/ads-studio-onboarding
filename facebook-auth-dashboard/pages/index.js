import Head from "next/head";
import { signIn, useSession } from "next-auth/react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import { useRouter } from "next/router";
import { useEffect } from "react";
import styles from "@/styles/Home.module.css";

export default function Home() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/report");
    }
  }, [status, router]);

  return (
    <>
      <Head>
        <title>Facebook Auth Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div className={styles.page} style={{ minHeight: "100vh", alignItems: "center" }}>
        <main
          className={styles.main}
          style={{ alignItems: "center", textAlign: "center", justifyContent: "center", margin: "auto" }}
        >
          <div className={styles.logoMark}>f</div>
          <h1 className={styles.h1}>Facebook Auth Dashboard</h1>
          <p className={styles.sub} style={{ maxWidth: 360 }}>
            Sign in with Facebook to view your profile, Pages, and Ad Account performance.
          </p>
          <button className={styles.btnPrimary} data-track="login_clicked" onClick={() => signIn("facebook", { callbackUrl: "/report" })}>
            Continue with Facebook
          </button>
        </main>
      </div>
    </>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  if (session) {
    return { redirect: { destination: "/report", permanent: false } };
  }
  return { props: {} };
}
