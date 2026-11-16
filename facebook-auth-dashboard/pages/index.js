import Head from "next/head";
import { signIn, useSession } from "next-auth/react";
import { getServerSession } from "next-auth/next";
import { authOptions } from "./api/auth/[...nextauth]";
import { googleAuthActive, googleAuthMode } from "@/lib/googleTest";
import { useRouter } from "next/router";
import { useEffect } from "react";
import TwoStepSignIn from "@/components/onboarding/TwoStepSignIn";
import styles from "@/styles/Home.module.css";

export default function Home({ googleTest = false, testMode = false }) {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // With Google sign-in on, signing in with Google alone isn't done yet: Facebook still has to be connected.
    if (status === "authenticated" && (!googleTest || session?.fbConnected)) {
      router.replace("/report");
    }
  }, [status, router, googleTest, session?.fbConnected]);
  const googleEmail = googleTest ? session?.googleEmail : null;

  if (googleTest) {
    return (
      <>
        <Head>
          <title>Get started · Facebook Auth Dashboard</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <TwoStepSignIn googleEmail={googleEmail} denied={router.query.google_denied} deniedDomain={router.query.d} signedInLoading={status === "loading"} testMode={testMode} />
      </>
    );
  }

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
  const googleTest = googleAuthActive(context.req);
  // Google sign-in off for this browser: any session goes to the app. Otherwise only once Google AND Facebook are connected.
  if (session && (!googleTest || (session.googleEmail && session.fbConnected))) {
    return { redirect: { destination: "/report", permanent: false } };
  }
  return { props: { googleTest, testMode: googleTest && googleAuthMode() === "test" } };
}
