import Sidebar from "./Sidebar";
import styles from "@/styles/Home.module.css";

// Persistent app shell: a fixed sidebar (nav + sign out) and a scrollable
// content area. Each page keeps rendering its own existing .page/.main
// structure unchanged inside this — .page's `justify-content: center`
// still centers .main, just within the remaining width next to the sidebar.
export default function Layout({ children }) {
  return (
    <div className={styles.appShell}>
      <Sidebar />
      <div className={styles.appContent}>{children}</div>
    </div>
  );
}
