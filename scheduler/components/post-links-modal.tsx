"use client";

import { CheckCircle2, ExternalLink, LoaderCircle, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { getPlatformById } from "@/lib/config";
import type { PostingProgressResult } from "@/lib/posting/progress-client";

import { PlatformIcon } from "./platform-icons";

interface PostLinksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: PostingProgressResult[];
  posting?: boolean;
}

function getPlatformDisplayName(platform: string): string {
  const normalizedPlatform = platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
  const config = getPlatformById(normalizedPlatform);
  return config?.name || platform;
}

function getPrimaryPostUrl(result: PostingProgressResult): string | undefined {
  return result.postUrl || result.threadResults?.find((segment) => segment.success && segment.postUrl)?.postUrl;
}

export function PostLinksModal({ open, onOpenChange, results, posting = false }: PostLinksModalProps) {
  const successfulPosts = results.filter((result) => result.success === true);
  const failedPosts = results.filter((result) => result.success === false);
  const pendingPosts = results.filter((result) => result.success === undefined);
  const completedPosts = successfulPosts.length + failedPosts.length;
  const isPosting = posting || pendingPosts.length > 0;
  const progress = results.length > 0 ? (completedPosts / results.length) * 100 : 0;
  const hasTikTokTarget = results.some((result) => result.platform.toLowerCase() === "tiktok");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isPosting && !nextOpen) return;
        onOpenChange(nextOpen);
      }}>
      <DialogContent
        className="max-w-[calc(100vw-2rem)] sm:max-w-lg"
        showCloseButton={!isPosting}
        onEscapeKeyDown={(event) => {
          if (isPosting) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (isPosting) event.preventDefault();
        }}>
        <DialogHeader>
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">{isPosting ? "Progress" : "Results"}</span>
          </div>
          <DialogTitle className="text-xl tracking-[-0.025em]">
            {isPosting ? "Posting your content" : "Posting results"}
          </DialogTitle>
          <DialogDescription aria-live="polite">
            {isPosting
              ? completedPosts === results.length
                ? "Posting complete. Finishing up…"
                : `${completedPosts} of ${results.length} platform${results.length === 1 ? "" : "s"} complete.`
              : successfulPosts.length > 0
                ? `Successfully posted to ${successfulPosts.length} platform${successfulPosts.length > 1 ? "s" : ""}.`
                : "Posting completed."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-w-full space-y-2 overflow-hidden">
          <Progress value={progress} aria-label={`${completedPosts} of ${results.length} platforms complete`} />

          {results.map((result) => {
            const isThread = result.threadResults && result.threadResults.length > 0;
            const totalSegments = isThread ? result.threadResults!.length : 1;
            const succeededSegments = isThread
              ? result.threadResults!.filter((s) => s.success).length
              : result.success
                ? 1
                : 0;
            const postUrl = getPrimaryPostUrl(result);

            return (
              <div
                key={result.accountId}
                className="flex h-14 min-w-0 items-center gap-3 overflow-hidden rounded-lg border border-border bg-secondary/40 px-3">
                <div className="flex w-5 flex-shrink-0 items-center justify-center">
                  {result.success === undefined ? (
                    <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>

                <div className="flex min-w-0 flex-1 items-center justify-between gap-2 overflow-hidden">
                  <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <PlatformIcon platform={result.platform} className="h-4 w-4 flex-shrink-0" />
                    <span className="truncate text-sm font-medium">{getPlatformDisplayName(result.platform)}</span>
                    {result.accountName && (
                      <span className="truncate text-xs text-muted-foreground">{result.accountName}</span>
                    )}
                    {isThread && (
                      <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">
                        {succeededSegments}/{totalSegments} posts
                      </span>
                    )}
                  </div>

                  <div className="flex h-8 w-20 flex-shrink-0 items-center justify-end">
                    {result.success === undefined ? (
                      <span className="text-xs text-muted-foreground">Posting…</span>
                    ) : result.success && postUrl ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-20 justify-end gap-2 px-0"
                        onClick={() => window.open(postUrl, "_blank", "noopener,noreferrer")}>
                        <ExternalLink className="h-4 w-4" />
                        View
                      </Button>
                    ) : result.success ? (
                      <span className="text-xs text-primary">Posted</span>
                    ) : (
                      <span className="text-xs text-destructive" title={result.message || result.error}>
                        Failed
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Summary */}
          <div className="pt-3 mt-2 border-t border-border flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em]">
            <span className="text-muted-foreground">Total</span>
            <div className="flex items-center gap-3">
              {successfulPosts.length > 0 && <span className="text-primary">{successfulPosts.length} success</span>}
              {failedPosts.length > 0 && <span className="text-destructive">{failedPosts.length} failed</span>}
              {pendingPosts.length > 0 && <span className="text-muted-foreground">{pendingPosts.length} posting</span>}
            </div>
          </div>

          {hasTikTokTarget && (
            <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
              TikTok may take a few minutes to process your content before it is visible on your profile.
            </p>
          )}
        </div>

        <DialogFooter className="h-9 flex-row justify-center sm:justify-center">
          <Button
            className={isPosting ? "invisible" : undefined}
            aria-hidden={isPosting}
            tabIndex={isPosting ? -1 : 0}
            onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
