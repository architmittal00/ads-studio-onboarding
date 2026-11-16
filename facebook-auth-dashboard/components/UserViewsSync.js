import { Fragment, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { hydrateViews, setViewsUser, flushViews, finishHydration } from "@/lib/userViews";

// Wraps the page. Keeps the person's saved views (see lib/userViews.js) in sync with the database, and when the database
// copy replaces what this browser held, re-mounts the page once so it starts from the right tabs. Renders its children
// straight away (no loading screen): the pages' first paint is unchanged.
export default function UserViewsSync({ children }) {
  const { data: session, status } = useSession();
  const email = session?.googleEmail || null;
  const [epoch, setEpoch] = useState(0);
  // During render, so a page's own first save (a child effect runs before this one's) already knows who the person is.
  setViewsUser(status === "authenticated" ? email : null);

  useEffect(() => {
    if (status !== "authenticated" || !email) return;
    hydrateViews(email).then((changed) => {
      if (changed) setEpoch((n) => n + 1);
    });
  }, [status, email]);
  // The page has been re-mounted on the new views (its children's effects have run): saving may begin.
  useEffect(() => {
    if (epoch > 0) finishHydration();
  }, [epoch]);

  useEffect(() => {
    const flush = () => flushViews();
    const onVisibility = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <Fragment key={epoch}>{children}</Fragment>;
}
