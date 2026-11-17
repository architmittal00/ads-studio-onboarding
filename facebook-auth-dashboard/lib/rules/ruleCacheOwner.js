import { useSession } from "next-auth/react";

// The saved rule-check results (Recommendations' full check, the "!" marks' light checks) can now contain a person's own
// custom rules (names, sentences, thresholds), so they belong to that person, not just to the ad account: every key carries
// a short hash of the Google email. Another person on the same browser (or one sharing the Meta account) therefore never
// reads them, and without a Google sign-in the tag is empty and the keys are exactly what they were before.
// Sign-out also removes them (components/Sidebar.js).
let tag = "";

function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function setRuleCacheOwner(email) {
  tag = email ? `${hash(String(email).toLowerCase())}:` : "";
}
export const ownerKey = () => tag;

// Call in any component that reads or writes those results. Sets the owner during render, before anything is read, and
// reports whether the session is known yet (nothing should be read or saved until it is).
export function useRuleCacheOwner() {
  const { data: session, status } = useSession();
  setRuleCacheOwner(status === "authenticated" ? session?.googleEmail || null : null);
  return status !== "loading";
}
