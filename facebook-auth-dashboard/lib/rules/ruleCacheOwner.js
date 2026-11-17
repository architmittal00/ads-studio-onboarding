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
// returns { known, owner }: whether the session is known yet (nothing should be read or saved until it is) and the owner
// tag for THIS render. A check must capture `owner` when it starts, key everything it reads and writes by that captured
// value, and drop its answer if `ownerKey()` is no longer the same when it finishes: the global can change underneath a
// request that is still running (another tab signs in as someone else), and a result must never land under a different person.
export function useRuleCacheOwner() {
  const { data: session, status } = useSession();
  setRuleCacheOwner(status === "authenticated" ? session?.googleEmail || null : null);
  return { known: status !== "loading", owner: ownerKey() };
}
