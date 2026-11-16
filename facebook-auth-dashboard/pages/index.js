import Head from "next/head";
import { signIn, useSession } from "next-auth/react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import { isTestRequest } from "@/lib/googleTest";
import { useRouter } from "next/router";
import { useEffect } from "react";
import styles from "@/styles/Home.module.css";

export default function Home({ googleTest = false }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // In the Google test flow, signing in with Google alone isn't done yet: Facebook still has to be connected.
    if (status === "authenticated" && (!googleTest || session?.fbConnected)) {
      router.replace("/report");
    }
  }, [status, router, googleTest, session?.fbConnected]);
  const googleEmail = googleTest ? session?.googleEmail : null;

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
          {googleTest ? (
            <>
              <p className={styles.sub} style={{ maxWidth: 360 }}>
                Test sign-in. {googleEmail ? `Signed in as ${googleEmail}. Now connect the Facebook login for ad access.` : "Sign in with Google first, then connect Facebook for ad access."}
              </p>
              {!googleEmail ? (
                <button className={styles.btnPrimary} data-track="login_clicked" onClick={() => signIn("google", { callbackUrl: "/" })}>
                  Continue with Google
                </button>
              ) : (
                <button className={styles.btnPrimary} data-track="login_clicked" onClick={() => signIn("facebook", { callbackUrl: "/report" })}>
                  Connect Facebook
                </button>
              )}
              <form action="/api/google-test/disable">
                <button type="submit" className={styles.btnSecondary} style={{ fontSize: 12 }}>
                  Leave the test and use the normal sign-in
                </button>
              </form>
            </>
          ) : (
            <>
              <p className={styles.sub} style={{ maxWidth: 360 }}>
                Sign in with Facebook to view your profile, Pages, and Ad Account performance.
              </p>
              <button className={styles.btnPrimary} data-track="login_clicked" onClick={() => signIn("facebook", { callbackUrl: "/report" })}>
                Continue with Facebook
              </button>
            </>
          )}
        </main>
      </div>
    </>
  );
}

export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);
  const googleTest = isTestRequest(context.req);
  // A normal browser: any session goes to the app. A test browser: only once Google AND Facebook are connected.
  if (session && (!googleTest || (session.googleEmail && session.fbConnected))) {
    return { redirect: { destination: "/report", permanent: false } };
  }
  return { props: { googleTest } };
}
