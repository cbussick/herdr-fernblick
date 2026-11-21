import { useState } from "react";
import { RouterProvider } from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import { createAppRouter } from "./router";

export function RoutedApp({ history }: { history?: RouterHistory } = {}) {
  const [router] = useState(() => createAppRouter(history));
  return <RouterProvider router={router} />;
}
