"use client";

import { useState } from "react";

import Link from "next/link";

import { Trash2, Edit, CalendarClock, ChevronLeft, ChevronRight, Quote, Send } from "lucide-react";
import { toast } from "sonner";

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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PostCardView } from "@/components/visual/post-card";
import { useAccounts } from "@/hooks/use-accounts";
import { useDeletePost, useSubmitPost } from "@/hooks/use-mutations";
import { usePaginatedPosts, type PaginationInfo, type PostsListType } from "@/hooks/use-posts";
import { getAccountDisplayName } from "@/lib/config";
import { logClientError } from "@/lib/logger/client";
import type { SocialPost, ConnectedAccount } from "@/types";

interface PostsListProps {
  type: PostsListType;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  onPostDeleted?: () => void;
}

function formatDate(date: Date): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "pm" : "am";
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, "0");

  return `${months[date.getMonth()]} ${date.getDate()}, ${displayHours}:${displayMinutes} ${ampm}`;
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  return formatDate(date);
}

export function PostsList({ type, page, pageSize, onPageChange, onPageSizeChange, onPostDeleted }: PostsListProps) {
  const { data, isLoading: postsLoading, isFetching } = usePaginatedPosts(type, page, pageSize);
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();

  const posts = data?.posts ?? [];
  const pagination = data?.pagination;
  const loading = postsLoading || accountsLoading;

  if (loading) {
    return <PostsListSkeleton />;
  }

  if (posts.length === 0) {
    return (
      <div className="border border-dashed border-border rounded-2xl p-12 text-center bg-card">
        <p className="text-sm text-muted-foreground">
          {type === "drafts"
            ? "No drafts yet."
            : type === "scheduled"
              ? "No scheduled posts yet."
              : type === "failed"
                ? "No failed posts."
                : "No published posts yet."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={`space-y-4 flex flex-col ${isFetching ? "opacity-70" : ""}`}>
        {posts.map((post: SocialPost) => (
          <PostCard key={post.id} post={post} accounts={accounts} onDeleted={onPostDeleted} />
        ))}
      </div>

      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Show</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              onPageSizeChange(Number(value));
              onPageChange(1);
            }}
            disabled={isFetching}>
            <SelectTrigger className="w-24 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <Pagination pagination={pagination} onPageChange={onPageChange} isFetching={isFetching} />
      )}
    </div>
  );
}

function Pagination({
  pagination,
  onPageChange,
  isFetching,
}: {
  pagination: PaginationInfo;
  onPageChange: (page: number) => void;
  isFetching: boolean;
}) {
  const { page, totalPages, total, hasNextPage, hasPreviousPage } = pagination;

  // Generate page numbers to show
  const getPageNumbers = (): (number | "ellipsis")[] => {
    const pages: (number | "ellipsis")[] = [];
    const showPages = 5; // Number of page buttons to show

    if (totalPages <= showPages + 2) {
      // Show all pages if total is small
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      // Always show first page
      pages.push(1);

      // Calculate start and end of middle section
      let start = Math.max(2, page - 1);
      let end = Math.min(totalPages - 1, page + 1);

      // Adjust if at the start
      if (page <= 3) {
        start = 2;
        end = Math.min(showPages - 1, totalPages - 1);
      }

      // Adjust if at the end
      if (page >= totalPages - 2) {
        start = Math.max(2, totalPages - showPages + 2);
        end = totalPages - 1;
      }

      // Add ellipsis before middle section if needed
      if (start > 2) {
        pages.push("ellipsis");
      }

      // Add middle pages
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }

      // Add ellipsis after middle section if needed
      if (end < totalPages - 1) {
        pages.push("ellipsis");
      }

      // Always show last page
      pages.push(totalPages);
    }

    return pages;
  };

  const pageNumbers = getPageNumbers();

  return (
    <div className="flex items-center justify-between border-t border-border pt-4 mt-4">
      <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {total} {total === 1 ? "post" : "posts"} total
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={!hasPreviousPage || isFetching}
          className="h-8 w-8 p-0">
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {pageNumbers.map((pageNum, idx) =>
          pageNum === "ellipsis" ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
              ...
            </span>
          ) : (
            <Button
              key={pageNum}
              variant={pageNum === page ? "default" : "outline"}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              disabled={isFetching}
              className="h-8 w-8 p-0">
              {pageNum}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={!hasNextPage || isFetching}
          className="h-8 w-8 p-0">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function PostCard({
  post,
  accounts,
  onDeleted,
}: {
  post: SocialPost;
  accounts: ConnectedAccount[];
  onDeleted?: () => void;
}) {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showScheduleDialog, setShowScheduleDialog] = useState(false);
  const deletePostMutation = useDeletePost();
  const submitPostMutation = useSubmitPost();

  // Get accounts for this post
  const postAccounts = accounts.filter((acc) => post.accountIds.includes(acc.id));

  // Get unique platforms from the accounts
  const uniquePlatforms = [...new Set(postAccounts.map((acc) => acc.platform))];

  const hasMedia = post.media.length > 0;
  const isDraft = post.status === "draft";
  const isScheduled = post.status === "scheduled";
  const isFailed = post.status === "failed";
  const canQuote = isScheduled || post.status === "published";

  const handleDelete = async () => {
    try {
      await deletePostMutation.mutateAsync(post.id);
      setShowDeleteDialog(false);
      if (onDeleted) {
        onDeleted();
      }
    } catch (error) {
      logClientError(error, "Failed to delete post", { postId: post.id });
      toast.error("Failed to delete post. Please try again.");
    }
  };

  const handlePostNow = async () => {
    const toastId = toast.loading("Posting draft...");

    try {
      const data = await submitPostMutation.mutateAsync({
        mode: "edit",
        postId: post.id,
        body: {
          message: post.message,
          accountIds: post.accountIds,
          postingMode: "now",
          accountOptions: post.accountOptions,
          accountOverrides: post.accountOverrides,
          repost: {
            enabled: post.repostEnabled === true,
            delayHours: post.repostDelayHours ?? 12,
          },
          media: post.media,
          thread: post.thread,
          quotePostId: post.quotePostId ?? null,
        },
      });

      const allSucceeded = data.postingResults?.every((result) => result.success) ?? false;
      if (allSucceeded) {
        toast.success("Draft posted.", { id: toastId });
      } else {
        toast.error("Draft could not be posted to every account.", { id: toastId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to post draft.";
      logClientError(error, "Failed to post draft", { postId: post.id });
      toast.error(message, { id: toastId });
    }
  };

  return (
    <>
      <Link href={`/posts/${post.id}`}>
        <PostCardView
          onImageError={(event) => {
            const target = event.currentTarget;
            if (!target.src.endsWith("/placeholder.jpg")) target.src = "/placeholder.jpg";
          }}
          post={post}
          platforms={uniquePlatforms}
          dateLabel={
            isScheduled && post.scheduledFor
              ? formatDate(post.scheduledFor)
              : isFailed
                ? formatTimeAgo(post.scheduledFor || post.createdAt)
                : isDraft
                  ? `Saved ${formatTimeAgo(post.createdAt)}`
                  : formatTimeAgo(post.publishedAt || post.createdAt)
          }
          accountLabels={[
            ...postAccounts.slice(0, 2).map((account) => getAccountDisplayName(account)),
            ...(postAccounts.length > 2 ? [`+${postAccounts.length - 2}`] : []),
          ]}
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-shrink-0 h-8 w-8 p-0"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}>
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                    />
                  </svg>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isDraft && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      void handlePostNow();
                    }}
                    disabled={submitPostMutation.isPending}
                    className="cursor-pointer">
                    <Send className="h-4 w-4 mr-2" />
                    {submitPostMutation.isPending ? "Posting..." : "Post Now"}
                  </DropdownMenuItem>
                )}
                {(isScheduled || isDraft) && (
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setShowScheduleDialog(true);
                    }}
                    className="cursor-pointer">
                    <CalendarClock className="h-4 w-4 mr-2" />
                    {isScheduled ? "Reschedule" : "Schedule"}
                  </DropdownMenuItem>
                )}
                {(isScheduled || isDraft || isFailed) && (
                  <Link href={`/posts/${post.id}/edit`}>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="cursor-pointer">
                      <Edit className="h-4 w-4 mr-2" />
                      {isFailed ? "Edit and Retry" : "Edit"}
                    </DropdownMenuItem>
                  </Link>
                )}
                {canQuote && (
                  <Link href={`/schedule?quotePostId=${post.id}`}>
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="cursor-pointer">
                      <Quote className="h-4 w-4 mr-2" />
                      Quote
                    </DropdownMenuItem>
                  </Link>
                )}
                <DropdownMenuItem
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowDeleteDialog(true);
                  }}
                  className="text-destructive focus:text-destructive cursor-pointer">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
      </Link>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this {isDraft ? "draft" : "post"}
              {hasMedia ? " and all associated media files" : ""}. This action cannot be undone.
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

function PostsListSkeleton() {
  return (
    <div className="border border-border rounded-2xl p-12 bg-card">
      <div className="flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Loading posts…</p>
      </div>
    </div>
  );
}
