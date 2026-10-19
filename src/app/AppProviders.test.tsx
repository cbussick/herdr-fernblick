import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import {
  MutationObserver,
  onlineManager,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AppProviders } from "./AppProviders";

let renderer: ReactTestRenderer | undefined;
let client: QueryClient | undefined;
afterEach(async () => {
  await act(async () => renderer?.unmount());
  client?.clear();
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

it("fails an offline action immediately instead of queuing it for reconnection", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  function Capture() {
    client = useQueryClient();
    return null;
  }
  await act(async () => {
    renderer = create(
      <AppProviders>
        <Capture />
      </AppProviders>,
    );
  });
  onlineManager.setOnline(false);
  const action = vi.fn().mockRejectedValue(new Error("Network unavailable"));
  const mutation = new MutationObserver(client!, { mutationFn: action });
  await expect(mutation.mutate(undefined)).rejects.toThrow("Network unavailable");
  expect(action).toHaveBeenCalledOnce();
  expect(mutation.getCurrentResult().isPaused).toBe(false);
  onlineManager.setOnline(true);
  await Promise.resolve();
  expect(action).toHaveBeenCalledOnce();
});
