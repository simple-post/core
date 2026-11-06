"use client";

import { useState } from "react";

import Link from "next/link";

import { Trash2, Edit, CalendarClock, ChevronLeft, ChevronRight, Quote, Send } from "lucide-react";
import { toast } from "sonner";

import { SchedulePostDialog } from "@/components/schedule-post-dialog";
import { TikTokRecoveryNotice } from "@/components/tiktok-recovery-notice";
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
import { useWorkspaceReadOnly } from "@/hooks/use-billing";
import { useDeletePost, useSubmitPost } from "@/hooks/use-mutations";
import { usePaginatedPosts, type PaginationInfo, type PostsListType } from "@/hooks/use-posts";
import { getAccountDisplayName } from "@/lib/config";
import type { SourceCopy } from "@/lib/i18n/source-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { logClientError } from "@/lib/logger/client";
import { getTikTokPostRecovery } from "@/lib/posting/tiktok-recovery";
import type { SocialPost, ConnectedAccount } from "@/types";

interface PostsListProps {
  type: PostsListType;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  onPostDeleted?: () => void;
}

function formatDate(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(
    date,
  );
}
function formatTimeAgo(date: Date, locale: string, copy: SourceCopy): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return copy("just now");
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 24) return relative.format(-hours, "hour");
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 30) return relative.format(-days, "day");
  return formatDate(date, locale);
}

export function PostsList({ type, page, pageSize, onPageChange, onPageSizeChange, onPostDeleted }: PostsListProps) {
  const { copy, locale } = useUiCopy();
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
            ? copy("No drafts yet.")
            : type === "scheduled"
              ? copy("No scheduled posts yet.")
              : type === "failed"
                ? copy("No failed posts.")
                : copy("No published posts yet.")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {type === "failed" && posts.filter((post) => getTikTokPostRecovery(post)).length > 1 && (
        <TikTokRecoveryNotice posts={posts} />
      )}
      <div className={`space-y-4 flex flex-col ${isFetching ? "opacity-70" : ""}`}>
        {posts.map((post: SocialPost) => (
          <PostCard key={post.id} post={post} accounts={accounts} onDeleted={onPostDeleted} />
        ))}
      </div>

      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{copy("Show")}</span>
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
              <SelectItem value="25">{new Intl.NumberFormat(locale).format(25)}</SelectItem>
              <SelectItem value="50">{new Intl.NumberFormat(locale).format(50)}</SelectItem>
              <SelectItem value="100">{new Intl.NumberFormat(locale).format(100)}</SelectItem>
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
  const { copy, locale } = useUiCopy();
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
        {copy("{{count, number}} posts total", { count: total })}{" "}
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          aria-label={copy("Previous page")}
          disabled={!hasPreviousPage || isFetching}
          className="h-8 w-8 p-0">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>

        {pageNumbers.map((pageNum, idx) =>
          pageNum === "ellipsis" ? (
            <span key={`ellipsis-${idx}`} className="px-2 text-muted-foreground">
              ...
            </span>
          ) : (
            <Button
              key={new Intl.NumberFormat(locale).format(pageNum)}
              variant={pageNum === page ? "default" : "outline"}
              size="sm"
              onClick={() => onPageChange(pageNum)}
              aria-label={copy("Page {{page, number}}", { page: pageNum })}
              aria-current={pageNum === page ? "page" : undefined}
              disabled={isFetching}
              className="h-8 w-8 p-0">
              {new Intl.NumberFormat(locale).format(pageNum)}
            </Button>
          ),
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          aria-label={copy("Next page")}
          disabled={!hasNextPage || isFetching}
          className="h-8 w-8 p-0">
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
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
  const { copy, locale } = useUiCopy();
  const readOnly = useWorkspaceReadOnly();
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
      toast.error(copy("Failed to delete post. Please try again."));
    }
  };

  const handlePostNow = async () => {
    const toastId = toast.loading(copy("Posting draft..."));

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
      if (data.post?.status === "scheduled") {
        toast.info(copy("Queued — waiting for TikTok's request limit. We'll retry automatically."), { id: toastId });
      } else if (allSucceeded) {
        toast.success(copy("Draft posted."), { id: toastId });
      } else {
        toast.error(copy("Draft could not be posted to every account."), { id: toastId });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : copy("Failed to post draft.");
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
              ? formatDate(post.scheduledFor, locale)
              : isFailed
                ? formatTimeAgo(post.scheduledFor || post.createdAt, locale, copy)
                : isDraft
                  ? copy("Saved {{date}}", { date: formatTimeAgo(post.createdAt, locale, copy) })
                  : formatTimeAgo(post.publishedAt || post.createdAt, locale, copy)
          }
          accountLabels={[
            ...postAccounts.slice(0, 2).map((account) => getAccountDisplayName(account)),
            ...(postAccounts.length > 2 ? [`+${postAccounts.length - 2}`] : []),
          ]}
          actions={
            readOnly ? undefined : (
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
                      <Send className="h-4 w-4 me-2" />
                      {submitPostMutation.isPending ? copy("Posting...") : copy("Post Now")}
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
                      <CalendarClock className="h-4 w-4 me-2" />
                      {isScheduled ? copy("Reschedule") : copy("Schedule")}
                    </DropdownMenuItem>
                  )}
                  {(isScheduled || isDraft || isFailed) && (
                    <Link href={`/posts/${post.id}/edit`}>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                        className="cursor-pointer">
                        <Edit className="h-4 w-4 me-2" />
                        {isFailed ? copy("Edit and Retry") : copy("Edit")}
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
                        <Quote className="h-4 w-4 me-2" />
                        {copy("Quote")}{" "}
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
                    <Trash2 className="h-4 w-4 me-2" />
                    {copy("Delete")}{" "}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          }
        />
      </Link>

      <TikTokRecoveryNotice posts={[post]} />

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy("Delete Post?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {isDraft
                ? hasMedia
                  ? copy(
                      "This will permanently delete this draft and all associated media files. This action cannot be undone.",
                    )
                  : copy("This will permanently delete this draft. This action cannot be undone.")
                : hasMedia
                  ? copy(
                      "This will permanently delete this post and all associated media files. This action cannot be undone.",
                    )
                  : copy("This will permanently delete this post. This action cannot be undone.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePostMutation.isPending}>{copy("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deletePostMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deletePostMutation.isPending ? copy("Deleting...") : copy("Delete")}
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
  const { copy } = useUiCopy();
  return (
    <div className="border border-border rounded-2xl p-12 bg-card">
      <div className="flex flex-col items-center justify-center gap-3">
        <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
          {copy("Loading posts…")}
        </p>
      </div>
    </div>
  );
}
