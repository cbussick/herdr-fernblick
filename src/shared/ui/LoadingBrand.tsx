import { ScoutLogo } from "./ScoutLogo";
import styles from "./LoadingBrand.module.css";

// Shared by the real pending state and its Storybook preview.
export function LoadingBrand() {
  return (
    <>
      <div className={styles.logo}>
        <ScoutLogo animated />
      </div>
      <p className={styles.label}>Loading agents…</p>
    </>
  );
}
