import type { Preview } from "@storybook/react-vite";
import "../src/styles/tokens.css";
import "../src/styles/base.css";
import "./preview.css";

const preview: Preview = {
  parameters: {
    a11y: { test: "error" },
    controls: { expanded: true },
    backgrounds: { default: "Herdr canvas", values: [{ name: "Herdr canvas", value: "#f8f6fb" }] },
  },
};
export default preview;
