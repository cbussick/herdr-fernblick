import { StrictMode } from "react";
import { onlineManager } from "@tanstack/react-query";
import { PwaStatus } from "./pwa/PwaStatus";
import { AppUpdatesProvider } from "./pwa/AppUpdatesProvider";
import { createRoot } from "react-dom/client";
import tokenStyles from "./styles/tokens.module.css";
import baseStyles from "./styles/base.module.css";
import { App } from "./app/App";
import { AppProviders } from "./app/AppProviders";

document.documentElement.classList.add(tokenStyles.theme, baseStyles.document);
// TanStack defaults to online until it sees an event; offline PWA launches may not emit one.
onlineManager.setOnline(navigator.onLine);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <AppUpdatesProvider>
        <App />
        <PwaStatus />
      </AppUpdatesProvider>
    </AppProviders>
  </StrictMode>,
);
