"use client";

import Link from "next/link";

import { MessageSquareQuote } from "lucide-react";

import { AssistantSelector } from "@/components/assistant-selector";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * The pitch for SimplePost's differentiator, shown at the one moment it lands:
 * right after a user connects their first social account, when they are about
 * to go looking for a compose box. Embeds the real {@link AssistantSelector} so
 * the MCP URL can be copied without leaving the flow.
 */
export function AiConnectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="mb-1 flex items-center gap-2">
            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
              <MessageSquareQuote className="h-4 w-4" />
            </span>
            <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              The fastest way to post
            </span>
          </div>
          <DialogTitle className="text-xl tracking-[-0.025em]">
            Account connected. Now let your AI do the posting.
          </DialogTitle>
          <DialogDescription>
            Connect SimplePost to ChatGPT, Claude, or any MCP client and you can schedule from a conversation —
            &ldquo;draft a post about today&rsquo;s release and schedule it for 9am&rdquo;. No tab switching, no
            copy-paste.
          </DialogDescription>
        </DialogHeader>

        <AssistantSelector />

        <DialogFooter className="sm:justify-between">
          <Button type="button" variant="ghost" onClick={onClose}>
            Maybe later
          </Button>
          <Button asChild onClick={onClose}>
            <Link href="/integrations?onboarding=ai">Open setup guide</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
