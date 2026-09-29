import { QueryClient } from "@tanstack/react-query";

/**
 * One client for the app. Clinical queries are keyed by office and filters,
 * so switching office cancels the previous office's in-flight request (the
 * query functions pass React Query's AbortSignal to fetch) and revisiting an
 * office shows cached rows while a fresh copy loads.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
