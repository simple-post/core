"use client";

import { use, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { format } from "date-fns";
import { Trash2, Calendar, Clock, Edit, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
import { PlatformIconBadge } from "@/components/platform-icons";
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
import type { ConnectedAccount, MediaFile } from "@/types";

type FailedPlatform = {
  platform?: string;
  message?: string;
  error?: string;
};

export default function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: post, isLoading: postLoading } = usePost(id);
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const deletePostMutation = useDeletePost();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const loading = postLoading || accountsLoading;

  const handleDelete = async () => {
    try {
      await deletePostMutation.mutateAsync(id);
      router.push("/");
    } catch (error) {
      console.error("Failed to delete post:", error);
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
  const isScheduled = post.status === "scheduled";
  const isFailed = post.status === "failed";
  const failedPlatforms: FailedPlatform[] = Array.isArray(post.errorDetails?.failedPlatforms)
    ? (post.errorDetails.failedPlatforms as FailedPlatform[])
    : [];

  return (
    <>
      <div className="min-h-screen bg-background">
        <Navbar
          actions={
            <>
              {isScheduled && (
                <Link href={`/posts/${id}/edit`}>
                  <Button variant="outline" size="sm" className="gap-2">
                    <Edit className="h-4 w-4" />
                    <span className="hidden sm:inline">Edit</span>
                  </Button>
                </Link>
              )}
              <Button variant="destructive" size="sm" className="gap-2" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 className="h-4 w-4" />
                <span className="hidden sm:inline">Delete</span>
              </Button>
            </>
          }
        />

        <main className="max-w-4xl mx-auto px-[clamp(18px,4vw,48px)] py-6">
          <div className="space-y-3 animate-reveal">
            <BackLink />
            <div className="flex flex-wrap items-center gap-3">
              <div className="section-kicker !mb-0">
                <span className="section-kicker-dot" />
                <span className="section-kicker-label">
                  {isScheduled ? "Scheduled" : isFailed ? "Failed" : "Published"}
                </span>
              </div>
              <span className="h-3 w-px bg-border" />
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isScheduled ? (
                  <Calendar className="h-3.5 w-3.5" />
                ) : isFailed ? (
                  <AlertCircle className="h-3.5 w-3.5" />
                ) : (
                  <Clock className="h-3.5 w-3.5" />
                )}
                <span>
                  {isScheduled
                    ? format(post.scheduledFor, "EEEE, MMMM d, yyyy 'at' h:mm a")
                    : format(post.publishedAt || post.createdAt, "MMMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
            </div>
          </div>
          <div className="space-y-4 mt-5 animate-reveal animate-reveal-delay-1">
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
              {/* Message */}
              {post.message && (
                <p className="whitespace-pre-wrap text-base leading-relaxed text-foreground">{post.message}</p>
              )}

              {/* Media */}
              {post.media.length > 0 && (
                <div className="space-y-3">
                  {post.media.map((media: MediaFile) => (
                    <div key={media.id} className="rounded-xl overflow-hidden border border-border bg-secondary">
                      {media.type === "image" ? (
                        <img
                          src={media.url}
                          alt={media.filename}
                          className="w-full h-auto max-h-[600px] object-contain"
                          onError={(e) => {
                            const target = e.target as HTMLImageElement;
                            target.src = "/broken-image.png";
                          }}
                        />
                      ) : (
                        <div className="relative w-full bg-black">
                          <video
                            src={media.url}
                            controls
                            playsInline
                            className="w-full h-auto max-h-[600px] object-contain"
                            poster={media.thumbnailUrl}
                          />
                        </div>
                      )}
                      <div className="px-4 py-2 border-t border-border font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground flex items-center justify-between">
                        <span className="truncate normal-case tracking-normal">{media.filename}</span>
                        <span>{(media.size / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
              This will permanently delete this scheduled post
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
    </>
  );
}
