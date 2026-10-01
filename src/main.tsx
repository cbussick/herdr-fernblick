import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import tokenStyles from "./styles/tokens.module.css";
import baseStyles from "./styles/base.module.css";
import { App } from "./app/App";
import { AppProviders } from "./app/AppProviders";

document.documentElement.classList.add(tokenStyles.theme, baseStyles.document);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </StrictMode>,
);
