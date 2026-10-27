import Link from "next/link";
import { useRouter } from "next/router";
import Sidebar from "./Sidebar";
import MobileTabBar from "./MobileTabBar";
import styles from "@/styles/Home.module.css";
import { useIsMobile, isMobileSupportedPath } from "@/lib/useIsMobile";

// Persistent app shell: a fixed sidebar (nav + sign out) and a scrollable
// content area. Each page keeps rendering its own existing .page/.main
// structure unchanged inside this — .page's `justify-content: center`
// still centers .main, just within the remaining width next to the sidebar.
//
// On phone-width viewports the sidebar becomes a compact top bar, and only
// the screens listed in MOBILE_SUPPORTED_PATHS render; the rest show a short
// notice pointing at Custom Views rather than a broken desktop layout.
export default function Layout({ children }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const unsupported = isMobile && !isMobileSupportedPath(router.pathname);

  return (
    <div className={styles.appShell}>
      <Sidebar />
      <div className={styles.appContent}>
        {unsupported ? (
          <div className={styles.mobileUnsupported}>
            <h1 className={styles.h2}>Best on a larger screen</h1>
            <p className={styles.sub}>
              This screen isn&apos;t available on mobile yet. Custom Views, Partnership Ads and Catalog Ads are — everything else works on desktop.
            </p>
            <Link href="/explore" className={styles.btnPrimary}>
              Open Custom Views
            </Link>
          </div>
        ) : (
          children
        )}
      </div>
      {isMobile && <MobileTabBar />}
    </div>
  );
}
