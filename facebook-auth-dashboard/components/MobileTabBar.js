import Link from "next/link";
import { useRouter } from "next/router";
import styles from "@/styles/Home.module.css";
import { ChartIcon, HandshakeIcon, TagIcon } from "./icons";

// The three screens that work on a phone. Each is a whole app of its own with
// its own sub-navigation, so they live in a thumb-reach bar instead of the
// desktop rail. Path prefixes keep sub-pages (e.g. /partnership-ads/queue)
// highlighting their parent.
export const MOBILE_NAV = [
  { href: "/explore", label: "Views", title: "Custom Views", icon: ChartIcon },
  { href: "/partnership-ads", label: "Partners", title: "Partnership Ads", icon: HandshakeIcon },
  { href: "/catalog-ads", label: "Catalog", title: "Catalog Ads", icon: TagIcon },
];

export function mobileNavFor(pathname) {
  return MOBILE_NAV.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) || null;
}

export default function MobileTabBar() {
  const router = useRouter();
  const current = mobileNavFor(router.pathname);
  return (
    <nav className={styles.mobileTabBar} aria-label="Primary">
      {MOBILE_NAV.map((item) => {
        const Icon = item.icon;
        const active = current?.href === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={active ? `${styles.mobileTab} ${styles.mobileTabActive}` : styles.mobileTab}
            aria-current={active ? "page" : undefined}
          >
            <span className={styles.mobileTabIcon}>
              <Icon size={20} />
            </span>
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
