"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PlatformIcon } from "./platform-icons";
import { ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { getPlatformLabel } from "@/lib/utils/platforms";

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
export function PostLinksModal({ open, onOpenChange, results }: PostLinksModalProps) {
  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Posting Results</DialogTitle>
          <DialogDescription>
            {successCount > 0
              ? `Successfully posted to ${successCount} platform${successCount > 1 ? "s" : ""}`
              : "Posting completed"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {results.map((result) => {
            const label = getPlatformLabel(result.platform);
            const detail = result.success ? result.message : result.error || result.message;

            return (
              <div
                key={result.accountId}
                className={`rounded-lg border p-3 ${
                  result.success
                    ? "bg-green-50 dark:bg-green-950/20 border-green-500/20"
                    : "bg-red-50 dark:bg-red-950/20 border-red-500/20"
                }`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2">
                    {result.success ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <PlatformIcon platform={result.platform} className="h-4 w-4" />
                        <span className="text-sm font-medium">{label}</span>
                      </div>
                      {detail && (
                        <p className={`text-xs mt-1 ${result.success ? "text-muted-foreground" : "text-red-600"}`}>
                          {detail}
                        </p>
                      )}
                    </div>
                  </div>
                  {result.postUrl && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => window.open(result.postUrl, "_blank", "noopener,noreferrer")}>
                      <ExternalLink className="h-3 w-3" />
                      View
                    </Button>
                  )}
                </div>
              </div>
            );
          })}

          <div className="pt-2 border-t text-xs text-muted-foreground">
            {successCount} success{successCount === 1 ? "" : "es"}
            {failureCount > 0 ? ` • ${failureCount} failed` : ""}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

