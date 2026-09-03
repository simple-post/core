"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import Link from "next/link";

import { useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { queryKeys } from "@/lib/query-client";
import {
  createPostTools,
  registerCreatePostTools,
  type CreatedPostResult,
  type ModelContext,
} from "@/lib/webmcp/create-post-tools";

type WebMcpStatus = "loading" | "ready" | "unavailable" | "error";

const WebMcpContext = createContext<{ status: WebMcpStatus; created: CreatedPostResult | null }>({
  status: "loading",
  created: null,
});

// Register once for the signed-in app, independently of the instructions UI.
export function WebMcpProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<WebMcpStatus>("loading");
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

  return <WebMcpContext.Provider value={{ status, created }}>{children}</WebMcpContext.Provider>;
}

export function CreatePostWebMcp() {
  const { status, created } = useContext(WebMcpContext);

  return (
    <Collapsible className="mb-6">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="group h-8 text-xs text-muted-foreground">
          <Bot aria-hidden="true" />
          AI agent instructions
          <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <aside
          aria-label="WebMCP tools for agents"
          className="mt-2 rounded-lg border border-border bg-secondary/30 px-4 py-3">
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
            Agents: WebMCP tools are available throughout the signed-in app, even with these instructions closed. Use{" "}
            <code>list_accounts</code>, then <code>validate_post</code> and <code>create_post</code> to save, schedule,
            or publish directly with the signed-in account. Use <code>get_post</code> to verify the result. Only create
            posts the user has authorized. Use the{" "}
            <Link href="/schedule" className="underline underline-offset-4">
              create-post form
            </Link>{" "}
            if your browser does not support WebMCP or a required action is unavailable.
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
      </CollapsibleContent>
    </Collapsible>
  );
}
