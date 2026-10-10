import Link from "next/link";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import styles from "@/styles/Home.module.css";
import { getSidebarCollapsed, setSidebarCollapsed, setThemePreference } from "@/lib/clientStorage";
import { FileTextIcon, TargetIcon, DatabaseIcon, ListIcon, ChartIcon, PanelIcon, LogoutIcon, SunIcon, MoonIcon } from "./icons";

const LINKS = [
  { href: "/report", label: "Handover Report", icon: FileTextIcon },
  { href: "/strategy", label: "Figure Out Strategy", icon: TargetIcon },
  { href: "/explore", label: "Explore", icon: ChartIcon },
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
  const [hovering, setHovering] = useState(false);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = getSidebarCollapsed();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of a per-device localStorage preference on mount, not derivable from props/state
    if (saved != null) setCollapsed(saved);
    // Reflects whichever theme pages/_document.js's bootstrap script (or, with
    // no stored preference, the OS) already applied to <html> before this
    // mounted — not derived from props/state, so this can't just be computed
    // inline during render.
    setIsDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      setSidebarCollapsed(next);
      return next;
    });
  }

  function toggleTheme() {
    setIsDark((prev) => {
      const next = !prev;
      setThemePreference(next ? "dark" : "light");
      if (next) {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
      return next;
    });
  }

  // Persisted preference stays collapsed; hovering just temporarily reveals
  // labels without writing to localStorage, so the rail snaps back once the
  // pointer leaves.
  const expanded = !collapsed || hovering;

  const name = session?.user?.name || "";
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("") || "?";

  return (
    <nav
      className={expanded ? styles.appSidebar : `${styles.appSidebar} ${styles.appSidebarCollapsed}`}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <div className={styles.appSidebarHeader}>
        <div className={styles.logoMark} style={{ width: 32, height: 32, fontSize: 13 }}>
          f
        </div>
        {expanded && <span style={{ fontSize: 13, fontWeight: 800, color: "var(--t1)" }}>Ads Dashboard</span>}
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
              title={expanded ? undefined : link.label}
              className={active ? `${styles.appNavLink} ${styles.appNavLinkActive}` : styles.appNavLink}
            >
              <Icon size={17} />
              {expanded && <span>{link.label}</span>}
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
        {expanded && <span className={styles.appSidebarUserName}>{name || "Account"}</span>}
        <button
          type="button"
          className={styles.appSidebarIconBtn}
          onClick={toggleTheme}
          title={isDark ? "Switch to light theme" : "Switch to dark theme"}
        >
          {isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
        </button>
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
