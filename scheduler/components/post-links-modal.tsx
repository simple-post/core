"use client";

import { useState } from "react";

import Link from "next/link";

import { AlertCircle, CheckCircle2, ExternalLink, LoaderCircle, XCircle } from "lucide-react";

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
import { useAccounts } from "@/hooks/use-accounts";
import { reconnectHref } from "@/lib/accounts/reconnect-navigation";
import { getPlatformById } from "@/lib/config";
import type { PostingProgressResult } from "@/lib/posting/progress-client";

import { PlatformIcon } from "./platform-icons";

interface PostLinksModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  results: PostingProgressResult[];
  posting?: boolean;
  /** The saved SimplePost post, rather than a provider's post ID. */
  postId?: string;
  onRecover?: (returnTo: string, accountIds: string[]) => boolean;
  onEditFailed?: (accountIds: string[]) => void;
}

function getPlatformDisplayName(platform: string): string {
  const normalizedPlatform = platform.toLowerCase() === "twitter" ? "x" : platform.toLowerCase();
  const config = getPlatformById(normalizedPlatform);
  return config?.name || platform;
}

function getPrimaryPostUrl(result: PostingProgressResult): string | undefined {
  return result.postUrl || result.threadResults?.find((segment) => segment.success && segment.postUrl)?.postUrl;
}

export function PostLinksModal({
  open,
  onOpenChange,
  results,
  posting = false,
  postId,
  onRecover,
  onEditFailed,
}: PostLinksModalProps) {
  const [recoveryError, setRecoveryError] = useState(false);
  const { data: accounts = [] } = useAccounts();
  const successfulPosts = results.filter((result) => result.success === true);
  const uncertainPosts = results.filter((result) => result.uncertain);
  const failedPosts = results.filter((result) => result.success === false && !result.uncertain);
  const pendingPosts = results.filter((result) => result.success === undefined);
  const completedPosts = successfulPosts.length + failedPosts.length + uncertainPosts.length;
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
        className="max-h-[90dvh] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg"
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
              : uncertainPosts.length > 0
                ? "Publishing status is unknown. Check Posts before retrying."
                : failedPosts.length > 0 && successfulPosts.length > 0
                  ? `${successfulPosts.length} completed. ${failedPosts.length} ${failedPosts.length === 1 ? "destination needs" : "destinations need"} attention.`
                  : successfulPosts.length > 0
                    ? `Successfully completed for ${successfulPosts.length} platform${successfulPosts.length > 1 ? "s" : ""}.`
                    : failedPosts.length > 0
                      ? "Your post needs attention. Review the details below."
                      : "Posting completed."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-w-full space-y-2 overflow-hidden">
          {isPosting && (
            <Progress value={progress} aria-label={`${completedPosts} of ${results.length} platforms complete`} />
          )}

          {results.map((result) => {
            const isThread = result.threadResults && result.threadResults.length > 0;
            const totalSegments = isThread ? result.threadResults!.length : 1;
            const succeededSegments = isThread
              ? result.threadResults!.filter((s) => s.success).length
              : result.success
                ? 1
                : 0;
            const postUrl = getPrimaryPostUrl(result);
            const needsReconnect =
              result.error === "CREDENTIALS_ERROR" ||
              accounts.find((account) => account.id === result.accountId)?.credentialStatus?.action === "reconnect";
            const editHref = postId ? `/posts/${encodeURIComponent(postId)}/edit` : "/schedule";

            return (
              <div
                key={result.accountId}
                className="flex min-h-14 min-w-0 items-start gap-3 overflow-hidden rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <div className="flex w-5 flex-shrink-0 items-center justify-center pt-1.5">
                  {result.uncertain ? (
                    <AlertCircle className="h-5 w-5 text-amber-500" />
                  ) : result.success === undefined ? (
                    <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" />
                  ) : result.success ? (
                    <CheckCircle2 className="h-5 w-5 text-primary" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center justify-between gap-2 overflow-hidden">
                    <div className="flex min-w-0 items-center gap-2 overflow-hidden">
                      <PlatformIcon platform={result.platform} className="h-4 w-4 flex-shrink-0" />
                      <span className="shrink-0 text-sm font-medium">{getPlatformDisplayName(result.platform)}</span>
                      {result.accountName && (
                        <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                          {result.accountName}
                        </span>
                      )}
                      {isThread && (
                        <span className="flex-shrink-0 font-mono text-xs text-muted-foreground">
                          {succeededSegments}/{totalSegments} posts
                        </span>
                      )}
                    </div>

                    <div className="flex h-8 w-20 flex-shrink-0 items-center justify-end">
                      {result.uncertain ? (
                        <span className="text-xs text-amber-500">Check status</span>
                      ) : result.success === undefined ? (
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
                        <span className="text-xs text-primary" title={result.message}>
                          {result.message ? "Submitted" : "Posted"}
                        </span>
                      ) : (
                        <span className="text-xs text-destructive">Failed</span>
                      )}
                    </div>
                  </div>
                  {result.accountName && (
                    <p className="truncate text-xs text-muted-foreground sm:hidden">{result.accountName}</p>
                  )}
                  {result.success && result.message && (
                    <p className="mt-1 text-xs text-muted-foreground">{result.message}</p>
                  )}
                  {result.success === false && (
                    <div className="mt-2 space-y-2">
                      <p className="break-words text-sm text-foreground">
                        {result.uncertain
                          ? "We lost the connection while publishing. Open Posts to check whether it published before trying again."
                          : result.message ||
                            (result.error && !/^[A-Z][A-Z_0-9]+$/.test(result.error)
                              ? result.error
                              : needsReconnect
                                ? "Reconnect this account before trying again."
                                : "Publishing failed. Review this post before trying again.")}
                      </p>
                      {!isPosting && uncertainPosts.length === 0 && (
                        <div className="flex flex-wrap gap-2">
                          {needsReconnect && (
                            <Button asChild size="sm">
                              <Link
                                href={reconnectHref(result.accountId, editHref)}
                                onClick={(event) => {
                                  if (
                                    onRecover?.(
                                      editHref,
                                      failedPosts.map((post) => post.accountId),
                                    ) === false
                                  ) {
                                    event.preventDefault();
                                    setRecoveryError(true);
                                  }
                                }}>
                                Reconnect account
                              </Link>
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Summary */}
          {failedPosts.length > 0 && successfulPosts.length > 0 && uncertainPosts.length === 0 && !isPosting && (
            <p className="pt-1 text-xs text-muted-foreground">Only failed destinations will be selected for retry.</p>
          )}
          {recoveryError && (
            <p role="alert" className="text-sm text-destructive">
              Your edits could not be saved in this browser. Close this dialog and save your work before continuing.
            </p>
          )}
          <div className="pt-3 mt-2 border-t border-border flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em]">
            <span className="text-muted-foreground">Total</span>
            <div className="flex items-center gap-3">
              {successfulPosts.length > 0 && <span className="text-primary">{successfulPosts.length} success</span>}
              {failedPosts.length > 0 && <span className="text-destructive">{failedPosts.length} failed</span>}
              {pendingPosts.length > 0 && <span className="text-muted-foreground">{pendingPosts.length} posting</span>}
              {uncertainPosts.length > 0 && <span className="text-amber-500">{uncertainPosts.length} unknown</span>}
            </div>
          </div>

          {hasTikTokTarget && (
            <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
              TikTok may take a few minutes to process your content before it is visible on your profile.
            </p>
          )}
        </div>

        <DialogFooter className="min-h-9 flex-row flex-wrap justify-end sm:justify-end">
          <Button
            variant={failedPosts.length > 0 || uncertainPosts.length > 0 ? "outline" : "default"}
            className={isPosting ? "invisible" : undefined}
            aria-hidden={isPosting}
            tabIndex={isPosting ? -1 : 0}
            onClick={() => onOpenChange(false)}>
            Done
          </Button>
          {!isPosting && uncertainPosts.length > 0 && (
            <Button asChild>
              <Link href={postId ? `/posts/${encodeURIComponent(postId)}` : "/?tab=past"}>Check Posts</Link>
            </Button>
          )}
          {!isPosting &&
            uncertainPosts.length === 0 &&
            failedPosts.length > 0 &&
            (onEditFailed ? (
              <Button
                onClick={() => {
                  onEditFailed(failedPosts.map((post) => post.accountId));
                  onOpenChange(false);
                }}>
                Edit and retry
              </Button>
            ) : postId ? (
              <Button asChild>
                <Link href={`/posts/${encodeURIComponent(postId)}/edit`}>Edit and retry</Link>
              </Button>
            ) : (
              <Button onClick={() => onOpenChange(false)}>Edit post</Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
