import { useEffect, useState } from "react";
import styles from "@/styles/Home.module.css";

// Sticky section nav with scroll-spy: highlights whichever section is
// currently nearest the top of the viewport as the user scrolls the report.
export default function SectionNav({ sections }) {
  const [activeId, setActiveId] = useState(sections[0]?.id);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-10% 0px -70% 0px", threshold: 0 }
    );

    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [sections]);

  function handleClick(e, id) {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav className={styles.sideNav}>
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={activeId === s.id ? `${styles.sideNavLink} ${styles.sideNavLinkActive}` : styles.sideNavLink}
          onClick={(e) => handleClick(e, s.id)}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
