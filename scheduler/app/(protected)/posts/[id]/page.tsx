"use client";

import { use, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { format } from "date-fns";
import { Trash2, Calendar, Clock, Edit, AlertCircle } from "lucide-react";
import { toast } from "sonner";

import { BackLink } from "@/components/back-link";
import { Navbar } from "@/components/navbar";
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
import { Card } from "@/components/ui/card";
import { useAccounts } from "@/hooks/use-accounts";
import { useDeletePost } from "@/hooks/use-mutations";
import { usePost } from "@/hooks/use-posts";
import { getPlatformById } from "@/lib/config";
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
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 bg-muted rounded w-1/4" />
            <div className="h-64 bg-muted rounded" />
            <div className="h-32 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Post not found</h1>
            <Link href="/">
              <Button variant="outline">Back to Dashboard</Button>
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

        <main className="max-w-4xl mx-auto px-6 py-8">
          <BackLink />
          <div className="space-y-6 mt-4">
            {/* Status Badge */}
            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  isScheduled
                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    : isFailed
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : "bg-green-500/10 text-green-600 dark:text-green-400"
                }`}>
                {isScheduled ? "Scheduled" : isFailed ? "Failed" : "Published"}
              </span>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isScheduled ? (
                  <Calendar className="h-4 w-4" />
                ) : isFailed ? (
                  <AlertCircle className="h-4 w-4" />
                ) : (
                  <Clock className="h-4 w-4" />
                )}
                <span>
                  {isScheduled
                    ? format(post.scheduledFor, "EEEE, MMMM d, yyyy 'at' h:mm a")
                    : format(post.publishedAt || post.createdAt, "MMMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
            </div>

            {/* Error Message for Failed Posts */}
            {isFailed && (post.errorMessage || post.errorDetails) && (
              <Card className="p-4 border-red-500/20 bg-red-500/5">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="space-y-3 flex-1 min-w-0">
                    <p className="text-sm font-medium text-red-500">Post Failed</p>
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
              </Card>
            )}

            {/* Post Content */}
            <Card className="p-6 space-y-6">
              {/* Message */}
              {post.message && (
                <div className="prose prose-sm max-w-none dark:prose-invert">
                  <p className="whitespace-pre-wrap text-base leading-relaxed">{post.message}</p>
                </div>
              )}

              {/* Media */}
              {post.media.length > 0 && (
                <div className="space-y-4">
                  {post.media.map((media: MediaFile) => (
                    <div key={media.id} className="rounded-lg overflow-hidden bg-muted">
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
                      <div className="px-4 py-2 bg-muted/50 text-xs text-muted-foreground flex items-center justify-between">
                        <span>{media.filename}</span>
                        <span>{(media.size / 1024 / 1024).toFixed(2)} MB</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Accounts */}
            <Card className="p-6">
              <h3 className="text-sm font-medium mb-4">Publishing to</h3>
              <div className="space-y-3">
                {postAccounts.map((account: ConnectedAccount) => {
                  const platformConfig = getPlatformById(account.platform);
                  return (
                    <div key={account.id} className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${platformConfig?.color}`} />
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {account.displayName || account.username || account.email}
                        </div>
                        <div className="text-xs text-muted-foreground">{platformConfig?.name}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
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
