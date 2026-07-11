"use client";

import { use, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { format } from "date-fns";
import { Trash2, Calendar, CalendarClock, Clock, Edit, AlertCircle, FileText, Quote } from "lucide-react";
import { toast } from "sonner";

import { Navbar } from "@/components/navbar";
import { PlatformIconBadge } from "@/components/platform-icons";
import { SchedulePostDialog } from "@/components/schedule-post-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/use-accounts";
import { useDeletePost } from "@/hooks/use-mutations";
import { usePost } from "@/hooks/use-posts";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import { logClientError } from "@/lib/logger/client";
import type { ConnectedAccount, MediaFile } from "@/types";

type FailedPlatform = {
  platform?: string;
  message?: string;
  error?: string;
};

function MediaGallery({ media }: { media: MediaFile[] }) {
  if (media.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {media.map((item) => (
        <div key={`${item.id}-${item.url}`} className="rounded-xl overflow-hidden border border-border bg-secondary">
          {item.type === "image" ? (
            <img
              src={item.url}
              alt={item.filename}
              className="w-full h-auto max-h-[600px] object-contain"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                target.src = "/broken-image.png";
              }}
            />
          ) : (
            <div className="relative w-full bg-black">
              <video
                src={item.url}
                controls
                playsInline
                className="w-full h-auto max-h-[600px] object-contain"
                poster={item.thumbnailUrl}
              />
            </div>
          )}
          <div className="px-4 py-2 border-t border-border font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground flex items-center justify-between gap-3">
            <span className="truncate normal-case tracking-normal">{item.filename}</span>
            <span className="shrink-0">{(item.size / 1024 / 1024).toFixed(2)} MB</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PostContentSegment({
  label,
  message,
  media,
  showLabel = false,
}: {
  label: string;
  message: string;
  media: MediaFile[];
  showLabel?: boolean;
}) {
  return (
    <div className="space-y-4">
      {showLabel ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      ) : null}
      {message ? (
        <p className="whitespace-pre-wrap break-words text-base leading-relaxed text-foreground">{message}</p>
      ) : null}
      <MediaGallery media={media} />
    </div>
  );
}

export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: post, isLoading: postLoading } = usePost(id);
  const { data: quotePost } = usePost(post?.quotePostId ?? "");
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const deletePostMutation = useDeletePost();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);

  const loading = postLoading || accountsLoading;

  const handleDelete = async () => {
    try {
      await deletePostMutation.mutateAsync(id);
      router.push("/");
    } catch (error) {
      logClientError(error, "Failed to delete post", { postId: id });
      toast.error("Failed to delete post. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-secondary rounded w-1/4" />
            <div className="h-64 bg-secondary rounded" />
            <div className="h-32 bg-secondary rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-12">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Post not found</h1>
            <Link href="/">
              <Button variant="outline">Back to dashboard</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const postAccounts = accounts.filter((acc: ConnectedAccount) => post.accountIds.includes(acc.id));
  const isDraft = post.status === "draft";
  const isScheduled = post.status === "scheduled";
  const isFailed = post.status === "failed";
  const canQuote = isScheduled || post.status === "published";
  const thread = post.thread ?? [];
  const hasThread = thread.length > 0;
  const failedPlatforms: FailedPlatform[] = Array.isArray(post.errorDetails?.failedPlatforms)
    ? (post.errorDetails.failedPlatforms as FailedPlatform[])
    : [];

  return (
    <>
      <div className="min-h-screen bg-background">
        <Navbar />

        <main className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
          <div
            className="mb-6 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-card p-2 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none"
            aria-label="Post actions">
            {canQuote && (
              <Button asChild variant="ghost" className="h-11 w-full gap-2">
                <Link href={`/schedule?quotePostId=${id}`}>
                  <Quote className="h-4 w-4" />
                  Quote
                </Link>
              </Button>
            )}
            {(isScheduled || isDraft) && (
              <Button variant="ghost" className="h-11 w-full gap-2" onClick={() => setShowScheduleDialog(true)}>
                <CalendarClock className="h-4 w-4" />
                {isScheduled ? "Reschedule" : "Schedule"}
              </Button>
            )}
            {(isScheduled || isDraft || isFailed) && (
              <Button asChild variant="ghost" className="h-11 w-full gap-2">
                <Link href={`/posts/${id}/edit`}>
                  <Edit className="h-4 w-4" />
                  {isFailed ? "Edit and Retry" : "Edit"}
                </Link>
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-11 w-full gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowDeleteDialog(true)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>

          <div className="animate-reveal">
            <div className="flex flex-wrap items-center gap-3">
              <div className="section-kicker !mb-0">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">
                  {isDraft ? "Draft" : isScheduled ? "Scheduled" : isFailed ? "Failed" : "Published"}
                </span>
              </div>
              <span className="h-3 w-px bg-border" />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isDraft ? (
                  <FileText className="h-3.5 w-3.5" />
                ) : isScheduled ? (
                  <Calendar className="h-3.5 w-3.5" />
                ) : isFailed ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : (
                  <Clock className="h-3.5 w-3.5" />
                )}
                <span>
                  {isDraft
                    ? `Saved ${format(post.createdAt, "MMMM d, yyyy 'at' h:mm a")}`
                    : isScheduled && post.scheduledFor
                      ? format(post.scheduledFor, "EEEE, MMMM d, yyyy 'at' h:mm a")
                      : format(post.publishedAt || post.createdAt, "MMMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
            </div>
          </div>
          <div className="space-y-4 mt-5 animate-reveal animate-reveal-delay-1">
            {post.quotePostId ? (
              <Link href={`/posts/${post.quotePostId}`}>
                <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10">
                  <div className="flex items-start gap-3">
                    <Quote className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Quotes another SimplePost post</p>
                      <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">
                        {quotePost?.message || "Open the source post"}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ) : null}

            {/* Error Message for Failed Posts */}
            {isFailed && (post.errorMessage || post.errorDetails) && (
              <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="space-y-2 flex-1 min-w-0">
                    <p className="text-sm font-medium text-destructive">Post failed</p>
                    {post.errorMessage && <p className="text-sm text-muted-foreground">{post.errorMessage}</p>}
                    {failedPlatforms.length > 0 && (
                      <ul className="space-y-1.5 text-sm">
                        {failedPlatforms.map((fp, i) => {
                          const platformConfig = getPlatformById(
                            (fp.platform || "").toLowerCase() === "twitter" ? "x" : (fp.platform || "").toLowerCase(),
                          );
                          const platformName = platformConfig?.name || fp.platform || "Unknown";
                          const errMsg = fp.message || fp.error || "Unknown error";
                          return (
                            <li key={i} className="flex items-start gap-2 text-muted-foreground">
                              <span className="font-medium text-foreground">{platformName}:</span>
                              <span>{errMsg}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Post Content */}
            <div className="rounded-2xl border border-border bg-card p-6 space-y-6">
              <PostContentSegment label="Post 1" message={post.message} media={post.media} showLabel={hasThread} />

              {hasThread ? (
                <div className="space-y-0">
                  {thread.map((segment, index) => (
                    <div key={index} className="flex gap-3">
                      <div className="flex flex-col items-center pt-1">
                        <div className="w-px bg-border flex-1" />
                      </div>
                      <div className="flex-1 pb-2 pt-4">
                        <PostContentSegment
                          label={`Post ${index + 2}`}
                          message={segment.message}
                          media={segment.media ?? []}
                          showLabel
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Accounts */}
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="section-kicker">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">Publishing to</span>
              </div>
              <div className="space-y-3 mt-2">
                {postAccounts.map((account: ConnectedAccount) => {
                  const platformConfig = getPlatformById(account.platform);
                  return (
                    <div key={account.id} className="flex items-center gap-3">
                      <PlatformIconBadge platform={account.platform} className="size-7" iconClassName="text-xs" />
                      <div className="flex-1">
                        <div className="text-sm font-medium">{getAccountDisplayName(account)}</div>
                        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground mt-0.5">
                          {platformConfig?.name}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Delete Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this {isDraft ? "draft" : "post"}
              {post.media.length > 0 ? " and all associated media files" : ""}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePostMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deletePostMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletePostMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {(isScheduled || isDraft) && (
        <SchedulePostDialog post={post} open={showScheduleDialog} onOpenChange={setShowScheduleDialog} />
      )}
    </>
  );
}
