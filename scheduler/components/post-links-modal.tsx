"use client";

import { ExternalLink, CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPlatformById } from "@/lib/config";

import { PlatformIcon } from "./platform-icons";

interface ThreadSegmentResult {
  index: number;
  success: boolean;
  postId?: string;
  postUrl?: string;
  error?: string;
  message?: string;
}

interface PostingResult {
  accountId: string;
  platform: string;
  success: boolean;
  error?: string;
  postUrl?: string;
  postId?: string;
  message?: string;
  details?: unknown;
  threadResults?: ThreadSegmentResult[];
  extraData?: {
    refreshedCredentials?: {
      accessToken?: string;
      refreshToken?: string;
      expiresAt?: number;
    };
  };
}

interface PostLinksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: PostingResult[];
}

function getPlatformDisplayName(platform: string): string {
  const normalizedPlatform = platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
  const config = getPlatformById(normalizedPlatform);
  return config?.name || platform;
}

export function PostLinksModal({ open, onOpenChange, results }: PostLinksModalProps) {
  const successfulPosts = results.filter((r) => r.success);
  const failedPosts = results.filter((r) => !r.success);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Results</span>
          </div>
          <DialogTitle className="text-xl tracking-[-0.025em]">Posting results</DialogTitle>
          <DialogDescription>
            {successfulPosts.length > 0
              ? `Successfully posted to ${successfulPosts.length} platform${successfulPosts.length > 1 ? "s" : ""}.`
              : "Posting completed."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {results.map((result) => {
            const isThread = result.threadResults && result.threadResults.length > 0;
            const totalSegments = isThread ? result.threadResults!.length : 1;
            const succeededSegments = isThread
              ? result.threadResults!.filter((s) => s.success).length
              : result.success
                ? 1
                : 0;

            return (
              <div
                key={result.accountId}
                className="flex items-start gap-3 rounded-lg border border-border bg-secondary/40 p-3">
                <div className="mt-0.5 flex-shrink-0">
                  {result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>

                <div className="min-w-0 flex-1 overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 overflow-hidden">
                      <PlatformIcon platform={result.platform} className="h-4 w-4 flex-shrink-0" />
                      <span className="text-sm font-medium truncate">{getPlatformDisplayName(result.platform)}</span>
                      {isThread && (
                        <span className="text-xs text-muted-foreground font-mono flex-shrink-0">
                          {succeededSegments}/{totalSegments} posts
                        </span>
                      )}
                    </div>
                    {result.postUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-2 flex-shrink-0 h-7"
                        onClick={() => window.open(result.postUrl, "_blank", "noopener,noreferrer")}>
                        <ExternalLink className="h-4 w-4" />
                        View
                      </Button>
                    )}
                  </div>

                  {result.postId && !isThread && (
                    <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">id: {result.postId}</p>
                  )}
                  {!result.success && (
                    <p className="text-xs text-destructive mt-1 line-clamp-2 break-words">
                      {result.message || result.error}
                    </p>
                  )}
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
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
