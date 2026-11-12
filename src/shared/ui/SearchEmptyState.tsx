import { SearchIcon } from "./Icons";
import uiStyles from "./ui.module.css";
import styles from "./SearchEmptyState.module.css";

export function SearchEmptyState({
  message,
  onClear,
  className = "",
}: {
  message: string;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <div className={`${styles.state} ${className}`} data-ui="search-empty-state">
      <div className={styles.group}>
        <span className={uiStyles["empty-state-icon"]} aria-hidden="true">
          <SearchIcon />
        </span>
        <p role="status">{message}</p>
        {onClear && (
          <button type="button" className={styles.action} onClick={onClear}>
            Clear search
          </button>
        )}
      </div>
    </div>
  );
}
