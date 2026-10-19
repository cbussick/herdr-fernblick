import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppErrorBoundary } from "./AppErrorBoundary";

const queryClient = new QueryClient({
  defaultOptions: {
    // Agent actions must fail offline, not wait and execute after reconnection.
    mutations: { networkMode: "always", retry: false },
    queries: {
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AppErrorBoundary>
  );
}
