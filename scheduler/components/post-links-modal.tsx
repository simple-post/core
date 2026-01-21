"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "./platform-icons";
import { ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { getPlatformById } from "@/lib/config";

interface PostingResult {
  accountId: string;
  platform: string;
  success: boolean;
  error?: string;
  postUrl?: string;
  postId?: string;
  message?: string;
  details?: any;
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Posting Results</DialogTitle>
          <DialogDescription>
            {successfulPosts.length > 0
              ? `Successfully posted to ${successfulPosts.length} platform${successfulPosts.length > 1 ? "s" : ""}`
              : "Posting completed"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* All results in a simple list */}
          {results.map((result) => (
            <div
              key={result.accountId}
              className="flex items-center justify-between gap-3 rounded-lg border p-3">
              <div className="flex items-center gap-3 min-w-0">
                {result.success ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500 flex-shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <PlatformIcon platform={result.platform} className="h-4 w-4 flex-shrink-0" />
                    <span className="text-sm font-medium">{getPlatformDisplayName(result.platform)}</span>
                  </div>
                  {result.postId && (
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">ID: {result.postId}</p>
                  )}
                  {result.error && (
                    <p className="text-xs text-red-500 mt-0.5">{result.error}</p>
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
          <div className="pt-2 border-t flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total:</span>
            <div className="flex items-center gap-3">
              {successfulPosts.length > 0 && (
                <span className="text-green-500">{successfulPosts.length} success</span>
              )}
              {failedPosts.length > 0 && (
                <span className="text-red-500">{failedPosts.length} failed</span>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

