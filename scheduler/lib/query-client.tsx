"use client";

import { type ReactNode } from "react";

import { QueryCache, QueryClient, QueryClientProvider as TanstackQueryClientProvider } from "@tanstack/react-query";

import { logClientError } from "@/lib/logger/client";

function makeQueryClient() {
  return new QueryClient({
    // Catch-all for query failures, which are not handled (or logged) at the
    // call site. Mutation errors are intentionally NOT logged here: every
    // mutation is awaited in a component try/catch that logs with curated,
    // non-sensitive context, so a MutationCache handler would only duplicate
    // those logs (and leak raw mutation variables). We log queryKey/hash only
    // — structural identifiers, never request values.
    queryCache: new QueryCache({
      onError: (error, query) => {
        logClientError(error, "React Query request failed", {
          queryHash: query.queryHash,
          queryKey: query.queryKey,
        });
      },
    }),
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 60 * 1000, // 1 minute
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

export function QueryClientProvider({ children }: { children: ReactNode }) {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const queryClient = getQueryClient();

  return <TanstackQueryClientProvider client={queryClient}>{children}</TanstackQueryClientProvider>;
}

// Export query keys for cache invalidation
export const queryKeys = {
  accounts: ["accounts"],
  posts: (type?: string) => (type ? ["posts", type] : ["posts"]),
  paginatedPosts: (type: string, page: number, limit: number) => ["posts", type, { page, limit }],
  post: (id: string) => ["posts", "detail", id],
} as const;
