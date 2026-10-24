/** Update lifecycle is per page: accepting an update in another tab never reloads this one. */
export function watchForAppUpdates(onAvailable: () => void) {
  const serviceWorker = navigator.serviceWorker;
  let registration: ServiceWorkerRegistration | undefined;
  let disposed = false;
  let controllerChanged = false;
  let applying = false;
  let finish: (() => void) | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cleanups: Array<() => void> = [];

  const controllerChange = () => {
    controllerChanged = true;
    if (applying) {
      clearTimeout(timeout);
      finish?.();
      window.location.reload();
    } else {
      onAvailable();
    }
  };
  serviceWorker.addEventListener("controllerchange", controllerChange);

  const check = () => {
    if (navigator.onLine && document.visibilityState === "visible") {
      void registration?.update().catch(() => {
        // Being online does not guarantee the tailnet/backend is reachable.
      });
    }
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  const interval = setInterval(check, 60_000);

  let registrationError: unknown;
  const ready = serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((value) => {
      if (disposed) return;
      registration = value;
      const notifyWaiting = () => {
        if (registration?.waiting) onAvailable();
      };
      const watchInstalling = () => {
        const worker = value.installing;
        if (!worker) return;
        const stateChange = () => {
          if (worker.state === "installed" && serviceWorker.controller) onAvailable();
        };
        worker.addEventListener("statechange", stateChange);
        cleanups.push(() => worker.removeEventListener("statechange", stateChange));
      };
      value.addEventListener("updatefound", watchInstalling);
      cleanups.push(() => value.removeEventListener("updatefound", watchInstalling));
      notifyWaiting();
      watchInstalling();
      check();
    })
    .catch((error: unknown) => {
      // Keep the app usable, but surface failures to a manual update check.
      registrationError = error;
    });

  return {
    async checkNow() {
      await ready;
      if (disposed) throw new Error("Update checking was stopped. Try again.");
      if (!registration)
        throw new Error(
          registrationError instanceof Error
            ? registrationError.message
            : "App update storage is unavailable.",
        );
      await registration.update();
      const worker = registration.installing;
      if (worker && worker.state !== "installed" && worker.state !== "activated") {
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            clearTimeout(timer);
            worker.removeEventListener("statechange", changed);
          };
          const changed = () => {
            if (worker.state === "installed" || worker.state === "activated") {
              finish();
              resolve();
            } else if (worker.state === "redundant") {
              finish();
              reject(new Error("The update could not be downloaded. Try again."));
            }
          };
          const timer = setTimeout(() => {
            finish();
            reject(new Error("The update download timed out. Try again."));
          }, 15_000);
          worker.addEventListener("statechange", changed);
          changed();
        });
      }
      const available = Boolean(registration.waiting || controllerChanged);
      if (available) onAvailable();
      return available;
    },
    async apply() {
      if (!navigator.onLine) throw new Error("Reconnect before refreshing.");
      if (controllerChanged) {
        window.location.reload();
        return;
      }
      const waiting = registration?.waiting;
      if (!waiting) throw new Error("The update is not ready. Try again shortly.");
      applying = true;
      await new Promise<void>((resolve, reject) => {
        finish = resolve;
        timeout = setTimeout(() => {
          applying = false;
          finish = undefined;
          reject(new Error("The update could not be applied. Try again."));
        }, 15_000);
        try {
          waiting.postMessage({ type: "SKIP_WAITING" });
        } catch (error) {
          clearTimeout(timeout);
          applying = false;
          finish = undefined;
          reject(error);
        }
      });
    },
    dispose() {
      disposed = true;
      applying = false;
      clearTimeout(timeout);
      finish?.();
      clearInterval(interval);
      cleanups.forEach((cleanup) => cleanup());
      serviceWorker.removeEventListener("controllerchange", controllerChange);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
    },
  };
}
