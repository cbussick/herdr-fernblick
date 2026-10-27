import type { Meta, StoryObj } from "@storybook/react-vite";
import { ScoutLogo } from "./ScoutLogo";
import { LoadingBrand } from "./LoadingBrand";
import styles from "./LoadingPreview.module.css";

function LoadingPreview() {
  return (
    <div className={styles.screen} role="status" aria-busy="true">
      <LoadingBrand />
    </div>
  );
}

const meta = {
  title: "Branding/Loading preview",
  component: LoadingPreview,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LoadingPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const LookingAround: Story = {};
export const VectorComparison: Story = {
  render: () => (
    <div className={styles.comparison}>
      <figure>
        <img src="/icons/scout-logo.png" width={564} height={594} alt="Original Fernblick logo" />
        <figcaption>Original PNG</figcaption>
      </figure>
      <figure>
        <ScoutLogo />
        <figcaption>Vector draft — flat colors</figcaption>
      </figure>
    </div>
  ),
};
