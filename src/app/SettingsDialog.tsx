import { useCallback, useEffect, useId, useRef, useState } from "react";
import { runningBuild, type BuildInfo } from "../pwa/buildInfo";
import { useAppUpdates } from "../pwa/useAppUpdates";
import { IconButton } from "../shared/ui";
import { Snackbar } from "../shared/ui/Snackbar";
import { ChevronIcon, CloseIcon } from "../shared/ui/Icons";
import styles from "./SettingsDialog.module.css";
import { getHeaderDiagnostics } from "./useHeaderDiagnostics";
import { ReadReceiptLogs } from "./ReadReceiptLogs";

function BuildDetails({ build }: { build: BuildInfo | null }) {
  if (!build) return <span>Not checked</span>;
  return (
    <span>
      <code title={build.revision}>
        {build.revision === "development" ? "Development" : build.revision.slice(0, 7)}
        {build.revision.endsWith("-dirty") ? "-dirty" : ""}
      </code>
      {build.builtAt ? (
        <time dateTime={build.builtAt}>{new Date(build.builtAt).toLocaleString()}</time>
      ) : (
        <small>Development preview</small>
      )}
    </span>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const updates = useAppUpdates();
  const [notice, setNotice] = useState<{
    id: number;
    kind: "current" | "copied" | "copy-failed";
  } | null>(null);
  const noticeSequence = useRef(0);
  const dismissNotice = useCallback(() => setNotice(null), []);
  function showNotice(kind: NonNullable<typeof notice>["kind"]) {
    setNotice({ id: ++noticeSequence.current, kind });
  }
  const [safeAreaTop, setSafeAreaTop] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const diagnosticsId = useId();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = dialog.ownerDocument.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);

  function diagnostics(inset = safeAreaTop) {
    return JSON.stringify(
      {
        app: "Fernblick",
        runningBuild,
        latestAvailableBuild: updates?.latest ?? null,
        updateStatus: updates?.result ?? "unavailable",
        updateError: updates?.error || null,
        online: navigator.onLine,
        secureContext: window.isSecureContext,
        displayMode:
          window.matchMedia("(display-mode: standalone)").matches ||
          Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
            ? "standalone"
            : "browser",
        serviceWorker: {
          supported: "serviceWorker" in navigator,
          controlled: Boolean(navigator.serviceWorker?.controller),
        },
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          pixelRatio: window.devicePixelRatio,
        },
        safeAreaTop: inset,
        headerLayout: getHeaderDiagnostics(),
        userAgent: navigator.userAgent,
      },
      null,
      2,
    );
  }

  const status = !updates
    ? "Update checks are unavailable in this preview."
    : updates.error
      ? (updates.result === "failed" ? "Check failed. " : "Refresh failed. ") + updates.error
      : updates.available || updates.result === "update-ready"
        ? "Update ready."
        : null;

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby="settings-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose();
      }}
    >
      <div className={styles.content}>
        <header className={styles.header}>
          <h2 id="settings-heading">Settings</h2>
          <IconButton type="button" label="Close settings" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </header>
        <section className={styles.section} aria-labelledby="about-updates-heading">
          <h3 id="about-updates-heading">About &amp; Updates</h3>
          <dl className={styles.builds}>
            <div>
              <dt>Running build</dt>
              <dd data-testid="running-build">
                <BuildDetails build={runningBuild} />
              </dd>
            </div>
            <div>
              <dt>Latest available build</dt>
              <dd data-testid="latest-build">
                <BuildDetails build={updates?.latest ?? null} />
              </dd>
            </div>
          </dl>
          <p role="status" aria-live="polite" hidden={!status}>
            {status}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={!updates || updates.checking || updates.applying}
              onClick={async () => {
                dismissNotice();
                if ((await updates?.check()) === "up-to-date") showNotice("current");
              }}
            >
              {updates?.checking ? "Checking…" : "Check for updates"}
            </button>
            {updates?.available && (
              <button
                type="button"
                disabled={!updates.online || updates.applying || updates.checking}
                onClick={() => void updates.apply()}
              >
                {updates.applying ? "Refreshing…" : "Refresh app"}
              </button>
            )}
          </div>
          {updates?.available && (
            <p>
              Finish drafts in all open windows before refreshing. Refreshing reloads this window.
            </p>
          )}
        </section>
        <section className={styles.section} aria-labelledby="diagnostics-heading">
          <h3 id="diagnostics-heading">Diagnostics</h3>
          <div className={styles.actions}>
            <button
              type="button"
              onClick={async () => {
                try {
                  if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
                  const inset = probeRef.current
                    ? getComputedStyle(probeRef.current).paddingTop
                    : null;
                  setSafeAreaTop(inset);
                  await navigator.clipboard.writeText(diagnostics(inset));
                  showNotice("copied");
                } catch {
                  showNotice("copy-failed");
                }
              }}
            >
              Copy diagnostics
            </button>
            <button
              type="button"
              className={styles.view}
              aria-label="View diagnostics"
              aria-expanded={diagnosticsOpen}
              aria-controls={diagnosticsId}
              onClick={() => {
                setDiagnosticsOpen((open) => !open);
                dismissNotice();
                setSafeAreaTop(
                  probeRef.current ? getComputedStyle(probeRef.current).paddingTop : null,
                );
              }}
            >
              <ChevronIcon />
              View
            </button>
          </div>
          <pre id={diagnosticsId} tabIndex={0} aria-label="Diagnostics" hidden={!diagnosticsOpen}>
            {diagnostics()}
          </pre>
          <span ref={probeRef} className={styles.probe} aria-hidden="true" />
        </section>
        <ReadReceiptLogs />
      </div>
      {notice && (
        <Snackbar
          key={notice.id}
          placement="dialog"
          message={
            notice.kind === "current"
              ? "Up to date."
              : notice.kind === "copied"
                ? "Diagnostics copied."
                : "Copy failed. Choose View and select the text to copy manually."
          }
          role={notice.kind === "copy-failed" ? "alert" : "status"}
          duration={notice.kind === "copy-failed" ? null : 6_000}
          onDismiss={dismissNotice}
        />
      )}
    </dialog>
  );
}
