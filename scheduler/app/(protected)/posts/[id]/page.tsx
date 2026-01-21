"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getPlatformById } from "@/lib/config";
import { format } from "date-fns";
import { ArrowLeft, Trash2, Calendar, Clock, Edit } from "lucide-react";
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
import { usePost } from "@/hooks/use-posts";
import { useAccounts } from "@/hooks/use-accounts";
import { useDeletePost } from "@/hooks/use-mutations";
import type { ConnectedAccount, MediaFile } from "@/types";

export default function PostDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { data: post, isLoading: postLoading } = usePost(params.id);
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const deletePostMutation = useDeletePost();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const loading = postLoading || accountsLoading;

  const handleDelete = async () => {
    try {
      await deletePostMutation.mutateAsync(params.id);
      router.push("/");
    } catch (error) {
      console.error("Failed to delete post:", error);
      alert("Failed to delete post. Please try again.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
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
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-semibold">Post not found</h1>
            <Link href="/">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const postAccounts = accounts.filter((acc: ConnectedAccount) => post.accountIds.includes(acc.id));
  const isScheduled = post.status === "scheduled";

  return (
    <>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <header className="border-b border-border/50">
          <div className="max-w-4xl mx-auto px-6 py-8">
            <div className="flex items-center justify-between">
              <Link href="/">
                <Button variant="ghost" size="sm" className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Back
                </Button>
              </Link>
              <div className="flex items-center gap-2">
                {isScheduled && (
                  <Link href={`/posts/${params.id}/edit`}>
                    <Button variant="outline" size="sm">
                      <Edit className="h-4 w-4 mr-2" />
                      Edit
                    </Button>
                  </Link>
                )}
                <Button variant="destructive" size="sm" onClick={() => setShowDeleteDialog(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-4xl mx-auto px-6 py-8">
          <div className="space-y-6">
            {/* Status Badge */}
            <div className="flex items-center gap-3">
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  isScheduled
                    ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                    : "bg-green-500/10 text-green-600 dark:text-green-400"
                }`}>
                {isScheduled ? "Scheduled" : "Published"}
              </span>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {isScheduled ? <Calendar className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                <span>
                  {isScheduled
                    ? format(post.scheduledFor, "EEEE, MMMM d, yyyy 'at' h:mm a")
                    : format(post.publishedAt || post.createdAt, "MMMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
            </div>

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
