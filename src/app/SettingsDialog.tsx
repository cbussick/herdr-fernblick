import { useEffect, useRef, useState } from "react";
import { runningBuild, type BuildInfo } from "../pwa/buildInfo";
import { useAppUpdates } from "../pwa/useAppUpdates";
import { IconButton } from "../shared/ui";
import { CloseIcon } from "../shared/ui/Icons";
import styles from "./SettingsDialog.module.css";

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
  const [copyResult, setCopyResult] = useState<"copied" | "failed" | null>(null);
  const [safeAreaTop, setSafeAreaTop] = useState<string | null>(null);
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
        userAgent: navigator.userAgent,
      },
      null,
      2,
    );
  }

  const status = !updates
    ? "Update checks are unavailable in this preview."
    : updates.checking
      ? "Checking for updates…"
      : updates.error
        ? (updates.result === "failed" ? "Check failed. " : "Refresh failed. ") + updates.error
        : updates.available || updates.result === "update-ready"
          ? "Update ready."
          : updates.result === "up-to-date"
            ? "Up to date."
            : "Check which build is available from the server.";

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
          <p>The running build identifies the app loaded on this device, even when it is cached.</p>
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
          <p role="status" aria-live="polite">
            {status}
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              disabled={!updates || updates.checking || updates.applying}
              onClick={() => void updates?.check()}
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
          <p>Build and device details only. No conversations, prompts, images or agent paths.</p>
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
                  setCopyResult("copied");
                } catch {
                  setCopyResult("failed");
                }
              }}
            >
              Copy diagnostics
            </button>
          </div>
          {copyResult && (
            <p role="status">
              {copyResult === "copied"
                ? "Diagnostics copied."
                : "Copy failed. Open View diagnostics and select the text to copy manually."}
            </p>
          )}
          <details
            onToggle={(event) => {
              if (event.currentTarget.open) {
                setCopyResult(null);
                setSafeAreaTop(
                  probeRef.current ? getComputedStyle(probeRef.current).paddingTop : null,
                );
              }
            }}
          >
            <summary>View diagnostics</summary>
            <pre tabIndex={0} aria-label="Diagnostics">
              {diagnostics()}
            </pre>
          </details>
          <span ref={probeRef} className={styles.probe} aria-hidden="true" />
        </section>
      </div>
    </dialog>
  );
}
