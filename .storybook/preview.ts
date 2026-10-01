import type { Preview } from "@storybook/react-vite";
import tokenStyles from "../src/styles/tokens.module.css";
import baseStyles from "../src/styles/base.module.css";
import previewStyles from "./preview.module.css";

document.documentElement.classList.add(tokenStyles.theme, baseStyles.document);
document.body.classList.add(previewStyles.canvas);

const preview: Preview = {
  parameters: {
    a11y: { test: "error" },
    controls: { expanded: true },
    backgrounds: { default: "Herdr canvas", values: [{ name: "Herdr canvas", value: "#f5f9fd" }] },
  },
};
export default preview;
