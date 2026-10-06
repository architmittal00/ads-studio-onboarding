import Link from "next/link";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";
import styles from "@/styles/Home.module.css";

const LINKS = [
  { href: "/report", label: "Handover Report" },
  { href: "/strategy", label: "Figure Out Strategy" },
  { href: "/dashboard", label: "Raw Data" },
  { href: "/logs", label: "API Logs" },
];

export default function Sidebar() {
  const router = useRouter();

  return (
    <nav className={styles.appSidebar}>
      <div className={styles.appSidebarHeader}>
        <div className={styles.logoMark} style={{ width: 28, height: 28, fontSize: 12 }}>
          f
        </div>
        <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t1)" }}>Ads Dashboard</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
        {LINKS.map((link) => {
          const active = router.pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={active ? `${styles.appNavLink} ${styles.appNavLinkActive}` : styles.appNavLink}
            >
              {link.label}
            </Link>
          );
        })}
      </div>

      <button className={styles.btnSecondary} onClick={() => signOut({ callbackUrl: "/" })} style={{ width: "100%" }}>
        Sign out
      </button>
    </nav>
  );
}
