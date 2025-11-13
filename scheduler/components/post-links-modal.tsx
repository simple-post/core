"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "./platform-icons";
import { ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const platformMap: Record<string, string> = {
    x: "X (Twitter)",
    twitter: "X (Twitter)",
    youtube: "YouTube",
    instagram: "Instagram",
    facebook: "Facebook",
    tiktok: "TikTok",
    telegram: "Telegram",
  };
  return platformMap[platform.toLowerCase()] || platform;
}

export function PostLinksModal({ open, onOpenChange, results }: PostLinksModalProps) {
  const successfulPosts = results.filter((r) => r.success && r.postUrl);
  const failedPosts = results.filter((r) => !r.success);
  const successfulWithoutUrl = results.filter((r) => r.success && !r.postUrl);

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

        <div className="space-y-4">
          {/* Successful posts with URLs */}
          {successfulPosts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-green-600 dark:text-green-400">Successful Posts</h3>
              <div className="space-y-2">
                {successfulPosts.map((result) => (
                  <div
                    key={result.accountId}
                    className="rounded-lg border p-3 bg-green-50 dark:bg-green-950/20">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <PlatformIcon platform={result.platform} className="h-4 w-4" />
                            <span className="text-sm font-medium">{getPlatformDisplayName(result.platform)}</span>
                          </div>
                          {result.message && (
                            <p className="text-xs text-muted-foreground mb-1">{result.message}</p>
                          )}
                          {result.postId && (
                            <p className="text-xs text-muted-foreground font-mono">ID: {result.postId}</p>
                          )}
                          {result.extraData?.refreshedCredentials && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                              Credentials refreshed
                            </p>
                          )}
                        </div>
                      </div>
                      {result.postUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-2 flex-shrink-0"
                          onClick={() => window.open(result.postUrl, "_blank", "noopener,noreferrer")}>
                          <ExternalLink className="h-4 w-4" />
                          View
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Successful posts without URLs */}
          {successfulWithoutUrl.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-blue-600 dark:text-blue-400">Posted (No Link Available)</h3>
              <div className="space-y-2">
                {successfulWithoutUrl.map((result) => (
                  <div
                    key={result.accountId}
                    className="rounded-lg border p-3 bg-blue-50 dark:bg-blue-950/20">
                    <div className="flex items-start gap-3">
                      <CheckCircle2 className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <PlatformIcon platform={result.platform} className="h-4 w-4" />
                          <span className="text-sm font-medium">{getPlatformDisplayName(result.platform)}</span>
                        </div>
                        {result.message && (
                          <p className="text-xs text-muted-foreground mb-1">{result.message}</p>
                        )}
                        {result.postId && (
                          <p className="text-xs text-muted-foreground font-mono">ID: {result.postId}</p>
                        )}
                        {result.extraData?.refreshedCredentials && (
                          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                            Credentials refreshed
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Failed posts */}
          {failedPosts.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-red-600 dark:text-red-400">Failed Posts</h3>
              <div className="space-y-2">
                {failedPosts.map((result) => (
                  <div
                    key={result.accountId}
                    className="rounded-lg border p-3 bg-red-50 dark:bg-red-950/20">
                    <div className="flex items-start gap-3">
                      <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <PlatformIcon platform={result.platform} className="h-4 w-4" />
                          <span className="text-sm font-medium">{getPlatformDisplayName(result.platform)}</span>
                        </div>
                        {result.error && (
                          <p className="text-xs font-medium text-red-600 dark:text-red-400 mt-1">
                            Error: {result.error}
                          </p>
                        )}
                        {result.message && (
                          <p className="text-xs text-red-700 dark:text-red-300 mt-1">{result.message}</p>
                        )}
                        {result.details && (
                          <details className="mt-2">
                            <summary className="text-xs text-red-600 dark:text-red-400 cursor-pointer hover:underline">
                              View details
                            </summary>
                            <pre className="text-xs text-red-700 dark:text-red-300 mt-1 p-2 bg-red-100 dark:bg-red-950/40 rounded overflow-auto max-h-32">
                              {JSON.stringify(result.details, null, 2)}
                            </pre>
                          </details>
                        )}
                        {result.postId && (
                          <p className="text-xs text-muted-foreground font-mono mt-1">Post ID: {result.postId}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Summary */}
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Total:</span>
              <div className="flex items-center gap-4">
                <span className="text-green-600 dark:text-green-400">
                  {results.filter((r) => r.success).length} success
                </span>
                {failedPosts.length > 0 && (
                  <span className="text-red-600 dark:text-red-400">{failedPosts.length} failed</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

