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

function SendErrorDemo({ upload = false }: { upload?: boolean }) {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <Button onClick={() => setVisible(true)}>Show send error</Button>
      {visible && (
        <Snackbar
          message={
            upload
              ? "Image upload failed. Your message wasn’t sent."
              : "Couldn’t confirm your message was sent."
          }
          description={
            upload
              ? "Your draft and images are still here."
              : "Your draft is still here. Check the terminal before sending again."
          }
          role="alert"
          duration={null}
          action={{
            label: upload ? "Try again" : "Open terminal",
            onClick: () => setVisible(false),
          }}
          onDismiss={() => setVisible(false)}
        />
      )}
    </>
  );
}
export const UncertainSend: Story = { render: () => <SendErrorDemo /> };
export const UploadFailed: Story = { render: () => <SendErrorDemo upload /> };
