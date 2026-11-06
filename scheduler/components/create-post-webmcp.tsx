"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import Link from "next/link";

import { useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { UiCopy } from "@/components/ui-copy";
import { useWorkspaceReadOnly } from "@/hooks/use-billing";
import { useUiTranslation } from "@/lib/i18n/client";
import { localizedPostStatus } from "@/lib/i18n/presentation";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
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
  const { copy, locale } = useUiCopy();
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
      copy,
      locale,
      fetch: (...args) => fetch(...args),
      onCreated: (result) => {
        if (!controller.signal.aborted) setCreated(result);
        // A language change can replace tool registration while a prior write finishes.
        // Refresh its result even when that registration has been superseded.
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
  }, [queryClient, copy, locale]);

  return <WebMcpContext.Provider value={{ status, created }}>{children}</WebMcpContext.Provider>;
}

export function CreatePostWebMcp() {
  const { t } = useUiTranslation();
  const { copy } = useUiCopy();
  const readOnly = useWorkspaceReadOnly();
  const { status, created } = useContext(WebMcpContext);

  if (readOnly) return null;
  return (
    <Collapsible className="mb-6">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="group h-8 text-xs text-muted-foreground">
          <UiCopy
            source="<part1></part1>AI agent instructions <part2></part2>"
            components={{
              part1: <Bot aria-hidden="true" />,
              part2: (
                <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
              ),
            }}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <aside
          aria-label={copy("WebMCP tools for agents")}
          className="mt-2 rounded-lg border border-border bg-secondary/30 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="h-4 w-4 text-primary" aria-hidden="true" />
            {copy("WebMCP for agents")}{" "}
            <span role="status" className="text-xs font-normal text-muted-foreground">
              {status === "ready"
                ? copy("Tools ready")
                : status === "loading"
                  ? copy("Connecting…")
                  : status === "unavailable"
                    ? copy("Compatible browser required")
                    : copy("Tools unavailable—reload to retry")}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            <UiCopy
              source="Agents: WebMCP tools are available throughout the signed-in app, even with these instructions closed. Use <part1></part1>, then <part2></part2> and <part3></part3> to save, schedule, or publish directly with the signed-in account. Use <part4></part4> to verify the result. Only create posts the user has authorized. Use the <part5>create-post form</part5> if your browser does not support WebMCP or a required action is unavailable."
              components={{
                part1: <code>list_accounts</code>,
                part2: <code>validate_post</code>,
                part3: <code>create_post</code>,
                part4: <code>get_post</code>,
                part5: <Link href="/schedule" className="underline underline-offset-4" />,
              }}
            />
          </p>
          {created && (
            <div role="status" className="mt-2 text-xs">
              <p>
                {created.replayed
                  ? copy("Post already saved via WebMCP. Status: {{status}}.", {
                      status: localizedPostStatus(created.post.status, t),
                    })
                  : copy("Post created via WebMCP. Status: {{status}}.", {
                      status: localizedPostStatus(created.post.status, t),
                    })}
              </p>
              {created.postingResults?.some((result) => !result.success) && (
                <p>{copy("Some accounts failed to publish.")}</p>
              )}
              <Link
                href={`/posts/${encodeURIComponent(created.post.id)}`}
                className="font-medium text-primary underline underline-offset-4">
                {copy("View post and results")}
              </Link>
            </div>
          )}
        </aside>
      </CollapsibleContent>
    </Collapsible>
  );
}
