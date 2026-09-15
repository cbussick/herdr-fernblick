import type { Meta, StoryObj } from "@storybook/react-vite";
const colors = [
  "canvas",
  "surface",
  "surface-subtle",
  "text",
  "text-secondary",
  "accent",
  "accent-soft",
  "danger",
  "warning",
  "success",
  "neutral",
];
const meta = { title: "Foundations/Tokens" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Colors: Story = {
  render: () => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
        gap: 16,
      }}
    >
      {colors.map((name) => (
        <div key={name}>
          <div
            style={{
              height: 80,
              borderRadius: 12,
              border: "1px solid var(--color-border)",
              background: `var(--color-${name})`,
            }}
          />
          <code style={{ display: "block", marginTop: 8, fontSize: 12 }}>--color-{name}</code>
        </div>
      ))}
    </div>
  ),
};
export const SpacingAndShape: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 16 }}>
      {["1", "2", "3", "4", "5", "6", "8"].map((value) => (
        <div key={value} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: `var(--space-${value})`,
              height: 16,
              background: "var(--color-accent)",
            }}
          />
          <code>--space-{value}</code>
        </div>
      ))}
    </div>
  ),
};
