import { useCallback, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from ".";
import { Snackbar } from "./Snackbar";

const meta = { title: "UI/Snackbar", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function RemovalDemo() {
  const [notice, setNotice] = useState(0);
  const dismiss = useCallback(() => setNotice(0), []);
  return (
    <>
      <Button onClick={() => setNotice((current) => current + 1)}>Show removal confirmation</Button>
      {notice > 0 && <Snackbar key={notice} message="Session removed" onDismiss={dismiss} />}
    </>
  );
}
export const SessionRemoved: Story = { render: () => <RemovalDemo /> };
