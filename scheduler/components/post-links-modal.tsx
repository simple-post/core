"use client";

import { ExternalLink, CheckCircle2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPlatformById } from "@/lib/config";

import { PlatformIcon } from "./platform-icons";

interface PostingResult {
  accountId: string;
  platform: string;
  success: boolean;
  error?: string;
  postUrl?: string;
  postId?: string;
  message?: string;
  details?: unknown;
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
  // Handle twitter alias
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
          {/* All results in a simple list */}
          {results.map((result) => (
            <div
              key={result.accountId}
              className="flex items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 p-3">
              <div className="flex items-center gap-3 min-w-0">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={result.platform} className="h-4 w-4 flex-shrink-0" />
                    <span className="text-sm font-medium">{getPlatformDisplayName(result.platform)}</span>
                  </div>
                  {result.postId && (
                    <p className="text-xs text-muted-foreground font-mono mt-0.5 break-all">id: {result.postId}</p>
                  )}
                  {!result.success && (
                    <p className="text-xs text-destructive mt-0.5">{result.message || result.error}</p>
                  )}
                </div>
              </div>
              {result.postUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2 flex-shrink-0"
                  onClick={() => window.open(result.postUrl, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-4 w-4" />
                  View
                </Button>
              )}
            </div>
          ))}

          {/* Summary */}
          <div className="pt-3 mt-2 border-t border-border flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em]">
            <span className="text-muted-foreground">Total</span>
            <div className="flex items-center gap-3">
              {successfulPosts.length > 0 && (
                <span className="text-primary">{successfulPosts.length} success</span>
              )}
              {failedPosts.length > 0 && <span className="text-destructive">{failedPosts.length} failed</span>}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
