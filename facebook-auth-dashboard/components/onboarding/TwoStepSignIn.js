import { signIn, signOut } from "next-auth/react";
import { CheckIcon, LockIcon, GoogleLogo, FacebookLogo } from "@/components/icons";
import styles from "@/styles/Onboarding.module.css";

const DENIED_TEXT = {
  domain: "That Google account isn't on an allowed domain. Sign in with a company account, or ask for yours to be added.",
  unverified: "Google says that email address isn't verified.",
  no_email: "Google didn't share an email address.",
  not_configured: "No allowed domains are set up yet (GOOGLE_AUTH_DOMAINS), so nobody can sign in.",
};

// The two-step sign-in: who you are, then the shared Facebook login for ad access. The steps are
// stated up front, the current one is lit, and a finished one shows what it holds.
export default function TwoStepSignIn({ googleEmail, denied, deniedDomain, signedInLoading, testMode = false }) {
  const step1Done = !!googleEmail;
  const deniedText = denied ? DENIED_TEXT[denied] : null;
  const current = step1Done ? 2 : 1;

  return (
    <div className={styles.shell}>
      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.layout}>
        <section className={styles.intro}>
          <div className={styles.logoRow}>
            <div className={styles.logo}>f</div>
            <span className={styles.brand}>Facebook Auth Dashboard</span>
          </div>
          <span className={styles.eyebrow}>Takes about a minute</span>
          <h1 className={styles.title}>Let&apos;s get you set up in two steps</h1>
          <p className={styles.lead}>
            Sign in as yourself, then connect your team&apos;s Facebook login. Everyone can share one Facebook login and still see who did what.
          </p>
          <ul className={styles.points}>
            <li>
              <span className={styles.pointDot}>1</span>
              <span>
                <strong>Google</strong> tells us who you are
              </span>
            </li>
            <li>
              <span className={styles.pointDot}>2</span>
              <span>
                <strong>Facebook</strong> gives access to your ad accounts
              </span>
            </li>
          </ul>
        </section>

        <section className={styles.panel} aria-label="Sign in steps">
          <div className={styles.progress} aria-hidden="true">
            <span className={styles.progressBar} style={{ width: step1Done ? "100%" : "50%" }} />
          </div>
          <p className={styles.stepCount}>
            Step {current} of 2
          </p>

          {deniedText && (
            <p className={styles.denied} role="alert">
              {deniedText}
              {deniedDomain ? ` (account domain: ${deniedDomain})` : ""}
            </p>
          )}

          <ol className={styles.steps}>
            <li className={`${styles.step} ${step1Done ? styles.stepDone : styles.stepActive}`}>
              <span className={styles.badge}>{step1Done ? <CheckIcon size={14} /> : "1"}</span>
              <div className={styles.stepBody}>
                <h2 className={styles.stepTitle}>Sign in with Google</h2>
                {step1Done ? (
                  <p className={styles.stepNote}>
                    Signed in as <strong>{googleEmail}</strong>
                    <button type="button" className={styles.linkBtn} onClick={() => signOut({ callbackUrl: "/" })}>
                      Use a different account
                    </button>
                  </p>
                ) : (
                  <>
                    <p className={styles.stepNote}>Use your company Google account so your activity is tied to you.</p>
                    <button type="button" className={styles.googleBtn} data-track="login_google_clicked" disabled={signedInLoading} onClick={() => signIn("google", { callbackUrl: "/" })}>
                      <GoogleLogo />
                      Continue with Google
                    </button>
                  </>
                )}
              </div>
            </li>

            <li className={`${styles.step} ${step1Done ? styles.stepActive : styles.stepLocked}`}>
              <span className={styles.badge}>{step1Done ? "2" : <LockIcon size={13} />}</span>
              <div className={styles.stepBody}>
                <h2 className={styles.stepTitle}>Connect Facebook</h2>
                <p className={styles.stepNote}>
                  {step1Done ? "Use your team's Facebook login. This is what lets the app read and manage your ad accounts." : "Unlocks after you sign in with Google."}
                </p>
                <button type="button" className={styles.fbBtn} data-track="login_facebook_clicked" disabled={!step1Done || signedInLoading} onClick={() => signIn("facebook", { callbackUrl: "/report" })}>
                  <FacebookLogo />
                  Continue with Facebook
                </button>
              </div>
            </li>
          </ol>

          {testMode && (
            <form action="/api/google-test/disable" className={styles.leave}>
              <button type="submit" className={styles.linkBtn}>
                Leave the test and use the normal sign-in
              </button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
