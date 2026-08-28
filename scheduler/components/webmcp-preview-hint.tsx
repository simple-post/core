"use client";

import { Bot, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const previewUrl = "https://simplepost.social/tools/social-media-post-preview/";

export function WebMcpPreviewHint() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Agent-assisted previews"
          aria-label="Learn about WebMCP preview tools"
          className="size-8 text-muted-foreground hover:text-foreground">
          <Bot className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-primary">Agent-assisted preview</p>
            <h2 className="mt-1 text-sm font-semibold text-foreground">Create variants before scheduling</h2>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            The free preview page exposes WebMCP tools in compatible browsers. An agent can prepare and show editable
            versions for each network without using your connected accounts.
          </p>
          <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 font-mono text-[11px] leading-5 text-muted-foreground">
            “Turn this idea into X, LinkedIn, and Instagram versions, then show the previews.”
          </div>
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Open the preview tool
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
