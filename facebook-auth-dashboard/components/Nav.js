import Link from "next/link";
import { useRouter } from "next/router";
import { signOut } from "next-auth/react";
import styles from "@/styles/Home.module.css";

const LINKS = [
  { href: "/report", label: "Handover Report" },
  { href: "/dashboard", label: "Raw Data" },
  { href: "/logs", label: "API Logs" },
];

export default function Nav() {
  const router = useRouter();

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {LINKS.map((link) => {
          const active = router.pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              className={styles.btnSecondary}
              style={
                active
                  ? { background: "rgba(175,70,253,.15)", borderColor: "rgba(175,70,253,.3)", color: "var(--purple)" }
                  : undefined
              }
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <button className={styles.btnSecondary} onClick={() => signOut({ callbackUrl: "/" })}>
        Sign out
      </button>
    </div>
  );
}
