import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import styles from "@/styles/Home.module.css";
import { getSidebarCollapsed, setSidebarCollapsed } from "@/lib/clientStorage";
import { FileTextIcon, TargetIcon, DatabaseIcon, ListIcon, PanelIcon, LogoutIcon } from "./icons";

const LINKS = [
  { href: "/report", label: "Handover Report", icon: FileTextIcon },
  { href: "/strategy", label: "Figure Out Strategy", icon: TargetIcon },
  { href: "/dashboard", label: "Raw Data", icon: DatabaseIcon },
  { href: "/logs", label: "API Logs", icon: ListIcon },
];

// Icon-rail sidebar, matching the slim collapsible pattern used across the
// team's other internal tools — icon-only by default, expandable to show
// labels too. The collapsed/expanded choice is a per-device preference
// (localStorage, like the rest of this app's client-side settings), not
// re-asked every visit.
export default function Sidebar() {
  const router = useRouter();
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(true);

  useEffect(() => {
    const saved = getSidebarCollapsed();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-device localStorage preference on mount, not derivable from props/state
    if (saved != null) setCollapsed(saved);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      setSidebarCollapsed(next);
      return next;
    });
  }

  const name = session?.user?.name || "";
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

  return (
    <nav className={collapsed ? `${styles.appSidebar} ${styles.appSidebarCollapsed}` : styles.appSidebar}>
      <div className={styles.appSidebarHeader}>
        <div className={styles.logoMark} style={{ width: 32, height: 32, fontSize: 13 }}>
          f
        </div>
        {!collapsed && <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t1)" }}>Ads Dashboard</span>}
      </div>

      <button
        type="button"
        className={styles.appSidebarIconBtn}
        onClick={toggleCollapsed}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <PanelIcon size={17} />
      </button>

      <div className={styles.appNavList}>
        {LINKS.map((link) => {
          const active = router.pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              title={collapsed ? link.label : undefined}
              className={active ? `${styles.appNavLink} ${styles.appNavLinkActive}` : styles.appNavLink}
            >
              <Icon size={17} />
              {!collapsed && <span>{link.label}</span>}
            </Link>
          );
        })}
      </div>

      <div className={styles.appSidebarFooter}>
        <div className={styles.appAvatar} title={name || "Account"}>
          {session?.user?.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- external Facebook CDN avatar; not worth Next/Image config for one small circular thumbnail
            <img src={session.user.image} alt="" className={styles.appAvatarImg} />
          ) : (
            initials
          )}
        </div>
        {!collapsed && <span className={styles.appSidebarUserName}>{name || "Account"}</span>}
        <button
          type="button"
          className={styles.appSidebarIconBtn}
          onClick={() => signOut({ callbackUrl: "/" })}
          title="Sign out"
        >
          <LogoutIcon size={16} />
        </button>
      </div>
    </nav>
  );
}
