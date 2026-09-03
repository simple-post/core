"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { useQueryClient } from "@tanstack/react-query";
import { Bot } from "lucide-react";

import { queryKeys } from "@/lib/query-client";
import {
  createPostTools,
  registerCreatePostTools,
  type CreatedPostResult,
  type ModelContext,
} from "@/lib/webmcp/create-post-tools";

export function CreatePostWebMcp() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [created, setCreated] = useState<CreatedPostResult | null>(null);

  useEffect(() => {
    const context =
      (document as Document & { modelContext?: ModelContext }).modelContext ??
      (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
    if (!context) {
      setStatus("unavailable");
      return;
    }
    const controller = new AbortController();
    const tools = createPostTools({
      fetch: (...args) => fetch(...args),
      onCreated: (result) => {
        if (controller.signal.aborted) return;
        setCreated(result);
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: ["posts"] }),
          queryClient.invalidateQueries({ queryKey: queryKeys.billing }),
          queryClient.invalidateQueries({ queryKey: queryKeys.onboarding }),
        ]).catch((error: unknown) => console.warn("Could not refresh post counters", error));
      },
    });
    void registerCreatePostTools(context, tools, controller.signal)
      .then(() => {
        if (!controller.signal.aborted) setStatus("ready");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          controller.abort();
          setStatus("error");
          console.warn("Could not register Create Post WebMCP tools", error);
        }
      });
    return () => controller.abort();
  }, [queryClient]);

  return (
    <aside
      aria-label="WebMCP tools for agents"
      className="mb-6 rounded-lg border border-border bg-secondary/30 px-4 py-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
        WebMCP for agents
        <span role="status" className="text-xs font-normal text-muted-foreground">
          {status === "ready"
            ? "Tools ready"
            : status === "loading"
              ? "Connecting…"
              : status === "unavailable"
                ? "Compatible browser required"
                : "Tools unavailable—reload to retry"}
        </span>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        Agents: discover this page&apos;s WebMCP tools before using the form. Use <code>list_accounts</code>, then{" "}
        <code>validate_post</code> and <code>create_post</code> to save, schedule, or publish directly with the
        signed-in account. Use <code>get_post</code> to verify the result. Only create posts the user has authorized.
        Use the form if your browser does not support WebMCP or a required action is unavailable.
      </p>
      {created && (
        <p role="status" className="mt-2 text-xs">
          Post {created.replayed ? "already saved" : "created"} via WebMCP. Status: {created.post.status}.
          {created.postingResults?.some((result) => !result.success) && " Some accounts failed to publish."}{" "}
          <Link
            href={`/posts/${encodeURIComponent(created.post.id)}`}
            className="font-medium text-primary underline underline-offset-4">
            View post and results
          </Link>
        </p>
      )}
    </aside>
  );
}
