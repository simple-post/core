"use client";

import { useRef, useState, type FormEvent } from "react";

import Link from "next/link";

import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Eye, Heart, MessageSquare, RefreshCw } from "lucide-react";

import { PlatformFilter } from "@/components/platform-filter";
import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getPlatformById } from "@/components/visual/platforms";
import { workspaceHref } from "@/components/workspaces/switcher";
import { PlatformPostPreview } from "@/features/platform-preview/platform-post-preview";
import { reconnectHref } from "@/lib/accounts/reconnect-navigation";
import { useSession } from "@/lib/auth/auth-client";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { SocialInbox as InboxPage, SocialInboxItem } from "@/lib/social/activity";
import { cn } from "@/lib/utils";

const base = "/api/v1/social";

async function inboxRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "The inbox request failed.");
  return data as T;
}

function platformLabel(platform: string) {
  return getPlatformById(platform)?.name ?? platform;
}

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

type Receipt = { status: string; errorMessage?: string };

function InboxRow({
  item,
  workspaceId,
  canManage,
  showAccount,
  refresh,
  focusNext,
}: {
  item: SocialInboxItem;
  workspaceId?: string;
  canManage: boolean;
  showAccount: boolean;
  refresh: () => Promise<unknown>;
  focusNext: () => void;
}) {
  const { copy, locale } = useUiCopy();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [replyKey, setReplyKey] = useState<string>();
  const [replying, setReplying] = useState(false);
  const [liking, setLiking] = useState(false);
  const [replyFeedback, setReplyFeedback] = useState<string>();
  const [likeFeedback, setLikeFeedback] = useState<string>();
  const [sent, setSent] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  const [showSentReply, setShowSentReply] = useState(false);
  const author = item.author?.name || item.author?.username || copy("Unknown author");
  const kind = item.kind === "quote" ? copy("Quote post") : item.kind === "reply" ? copy("Reply") : copy("Comment");
  const replyState = sent ? "sent" : item.reply?.status;
  const isLiked = item.liked;
  const blocked = replyState === "pending" || replyState === "uncertain";
  const hasNativeItemLink = item.nativeUrl && item.nativeUrl !== item.sourceUrl;
  const actionUrl = `${base}/items/${encodeURIComponent(item.id)}`;

  async function replyToItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || replying) return;
    const key = replyKey ?? crypto.randomUUID();
    setReplyKey(key);
    setReplying(true);
    setReplyFeedback(undefined);
    try {
      const receipt = await inboxRequest<Receipt>(
        workspaceHref(`${actionUrl}/reply`, workspaceId),
        jsonPost({ body, idempotencyKey: key }),
      );
      if (receipt.status === "sent") {
        setSent(true);
        setOpen(false);
        setBody("");
        setReplyKey(undefined);
        focusNext();
      } else {
        setReplyFeedback(receipt.errorMessage ?? copy("Check the platform to confirm your reply."));
      }
      await refresh();
    } catch (error) {
      setReplyFeedback(error instanceof Error ? error.message : copy("Could not send reply."));
    } finally {
      setReplying(false);
    }
  }

  async function likeItem() {
    setLiking(true);
    setLikeFeedback(undefined);
    try {
      const receipt = await inboxRequest<Receipt>(workspaceHref(`${actionUrl}/like`, workspaceId), { method: "PUT" });
      if (receipt.status !== "sent")
        setLikeFeedback(receipt.errorMessage ?? copy("Check the platform to confirm your like."));
      await refresh();
    } catch (error) {
      setLikeFeedback(error instanceof Error ? error.message : copy("Could not like this item."));
    } finally {
      setLiking(false);
    }
  }

  return (
    <article className="border-t border-border/70 py-4 sm:py-5" id={`inbox-${item.id}`}>
      <div className="flex items-start gap-2.5 sm:gap-3">
        <PlatformIconBadge platform={item.platform} className="mt-0.5 size-7 border-0" iconClassName="text-xs" />
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            <span className="max-w-full truncate text-sm font-semibold text-foreground" title={item.author?.username}>
              {author}
            </span>
            <span>{kind}</span>
            {showAccount && (
              <>
                <span aria-hidden>·</span>
                <span className="max-w-full truncate">{item.accountName}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <time dateTime={item.createdAt} className="shrink-0">
              {new Intl.DateTimeFormat(locale, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(item.createdAt))}
            </time>
          </div>
          <p className="mt-1.5 text-sm leading-relaxed wrap-anywhere whitespace-pre-wrap">
            {item.body || copy("This item has no text.")}
          </p>

          {(item.canLike || replyState === "sent" || (item.canReply && !blocked)) && (
            <div className="mt-1.5 -ms-2 flex flex-wrap items-center gap-1 text-muted-foreground">
              {(isLiked || (canManage && item.canLike)) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={likeItem}
                  aria-pressed={isLiked}
                  disabled={isLiked || liking}
                  className={cn("gap-1.5 px-2", isLiked && "text-rose-400 disabled:opacity-100")}>
                  <Heart className={cn("size-4", isLiked && "fill-current")} aria-hidden />
                  {isLiked ? copy("Liked") : copy("Like")}
                </Button>
              )}
              {canManage && item.canReply && !blocked && replyState !== "sent" && (
                <Button
                  type="button"
                  variant={open ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setOpen(!open)}
                  aria-expanded={open}
                  data-inbox-reply
                  className="gap-1.5 px-2">
                  <MessageSquare className="size-4" aria-hidden />
                  {copy("Reply")}
                </Button>
              )}
              {replyState === "sent" && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={showSentReply}
                  onClick={() => setShowSentReply(!showSentReply)}
                  disabled={!item.reply}>
                  {copy("Replied")}
                </Button>
              )}
            </div>
          )}

          {(likeFeedback ?? item.likeError) && (
            <p role="status" className="mt-2 text-xs text-amber-300">
              {likeFeedback ?? item.likeError}
            </p>
          )}
          {blocked && (
            <p role="status" className="mt-2 text-xs text-amber-300">
              {copy("Check the platform to confirm your reply.")}
            </p>
          )}
          {showSentReply && item.reply && replyState === "sent" && (
            <div className="mt-2 border-s-2 border-border ps-3 text-sm text-muted-foreground">
              <p className="wrap-anywhere whitespace-pre-wrap">{item.reply.body}</p>
              {item.reply.nativeReplyUrl && (
                <a
                  className="mt-1 inline-block text-xs underline"
                  href={item.reply.nativeReplyUrl}
                  target="_blank"
                  rel="noreferrer">
                  {copy("Open on platform")}
                </a>
              )}
            </div>
          )}
          {open && !blocked && (
            <form onSubmit={replyToItem} className="mt-2 rounded-lg border border-border p-2">
              <div className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 px-2 py-1 text-xs text-muted-foreground">
                <span>{copy("Replying as {{account}}", { account: item.accountName })}</span>
              </div>
              <textarea
                className="min-h-20 w-full resize-y rounded-md bg-transparent p-2 text-sm focus-visible:outline-2 focus-visible:outline-primary"
                aria-label={copy("Write a reply")}
                placeholder={copy("Write a reply…")}
                autoFocus
                maxLength={5000}
                value={body}
                disabled={replying}
                onChange={(event) => {
                  setBody(event.target.value);
                  setReplyKey(undefined);
                }}
              />
              <div className="flex justify-end gap-2 border-t border-border/60 pt-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  {copy("Cancel")}
                </Button>
                <Button size="sm" disabled={replying || !body.trim()}>
                  {replying ? copy("Sending…") : copy("Reply and next")}
                </Button>
              </div>
            </form>
          )}
          {(replyFeedback ?? (replyState === "failed" ? item.reply?.errorMessage : undefined)) && (
            <p role="status" className="mt-2 text-xs text-amber-300">
              {replyFeedback ?? item.reply?.errorMessage}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            ref={previewTrigger}
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground"
            aria-label={copy("Preview original post")}
            title={copy("Preview original post")}
            onClick={() => setPreviewOpen(true)}>
            <Eye aria-hidden />
          </Button>
          {hasNativeItemLink && (
            <Button asChild variant="ghost" size="icon" className="size-9 text-muted-foreground">
              <a
                href={item.nativeUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={copy("Open on platform")}
                title={copy("Open on platform")}>
                <ArrowUpRight aria-hidden />
              </a>
            </Button>
          )}
        </div>
        {previewOpen && (
          <Dialog open onOpenChange={setPreviewOpen}>
            <DialogContent
              className="max-h-[85dvh] overflow-y-auto sm:max-w-lg"
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                previewTrigger.current?.focus();
              }}>
              <DialogHeader>
                <DialogTitle>{copy("Original post")}</DialogTitle>
                <DialogDescription>{item.accountName}</DialogDescription>
              </DialogHeader>
              {item.sourcePreview ? (
                <PlatformPostPreview
                  message={item.sourceBody}
                  media={item.sourcePreview.media}
                  selectedAccounts={[
                    {
                      id: item.accountId,
                      platform: item.platform,
                      username: item.accountUsername ?? null,
                      displayName: item.accountName,
                      email: null,
                      platformAccountId: item.accountId,
                      profilePicture: item.sourcePreview.profilePicture,
                    },
                  ]}
                  previewDate={item.sourcePreview.publishedAt ? new Date(item.sourcePreview.publishedAt) : null}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap">{item.sourceBody}</p>
              )}
            </DialogContent>
          </Dialog>
        )}
      </div>
    </article>
  );
}

export function SocialInbox({
  connection,
  workspaceId,
  canManage = true,
}: {
  connection?: string | null;
  workspaceId?: string;
  canManage?: boolean;
}) {
  const { copy } = useUiCopy();
  const { data: session } = useSession();
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [needsReply, setNeedsReply] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const queryClient = useQueryClient();
  const queryKey = ["social-inbox", session?.user.id, workspaceId];
  const feed = useInfiniteQuery({
    queryKey: [...queryKey, selectedPlatforms, needsReply],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (workspaceId) query.set("workspace", workspaceId);
      for (const platform of selectedPlatforms) query.append("platform", platform);
      if (needsReply) query.set("needsReply", "true");
      if (pageParam) query.set("cursor", pageParam);
      return inboxRequest<InboxPage>(`${base}/inbox?${query}`);
    },
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
    retry: false,
  });
  const items = feed.isPlaceholderData ? [] : (feed.data?.pages.flatMap((page) => page.items) ?? []);
  const accounts = feed.data?.pages[0]?.accounts ?? [];
  const accountCounts = new Map<string, number>();
  for (const account of accounts) {
    accountCounts.set(account.platform, (accountCounts.get(account.platform) ?? 0) + 1);
  }
  const platforms = [...accountCounts.keys()].sort((a, b) => platformLabel(a).localeCompare(platformLabel(b)));
  const lastSync = accounts
    .flatMap((account) => account.lastSyncedAt ?? [])
    .sort()
    .at(-1);
  const canSync = canManage && accounts.some((account) => account.canSync);
  const showSyncMore =
    canManage &&
    accounts.some(
      (account) => account.hasMore && (selectedPlatforms.length === 0 || selectedPlatforms.includes(account.platform)),
    );
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  const autoSync = useQuery({
    queryKey: ["social-inbox-sync", session?.user.id, workspaceId],
    enabled: Boolean(session?.user.id) && canSync && !syncing,
    staleTime: 60_000,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => {
      const result = await inboxRequest<{ accounts: unknown[] }>(
        workspaceHref(`${base}/inbox/refresh`, workspaceId),
        jsonPost({ automatic: true }),
      );
      if (result.accounts.length > 0) await refresh();
      return result;
    },
  });

  async function sync(reset: boolean) {
    setSyncing(true);
    setSyncError(undefined);
    try {
      await inboxRequest(
        workspaceHref(`${base}/inbox/refresh`, workspaceId),
        jsonPost({ reset, ...(selectedPlatforms.length > 0 ? { platforms: selectedPlatforms } : {}) }),
      );
      await refresh();
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : copy("Could not refresh the inbox."));
    } finally {
      setSyncing(false);
    }
  }

  function focusNext(index: number) {
    const next = items
      .slice(index + 1)
      .find((item) => item.canReply && !["sent", "uncertain", "pending"].includes(item.reply?.status ?? ""));
    const button =
      next &&
      document
        .querySelector(`#${CSS.escape(`inbox-${next.id}`)}`)
        ?.querySelector<HTMLButtonElement>("[data-inbox-reply]");
    if (button?.getAttribute("aria-expanded") === "true") {
      button.closest("article")?.querySelector("textarea")?.focus();
    } else if (button) {
      button.click();
    } else {
      document.querySelector<HTMLElement>("#inbox-filters")?.focus();
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-[clamp(18px,4vw,48px)] pt-6 pb-16">
      <header className="mb-5 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{copy("Inbox")}</h1>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={copy("Refresh inbox")}
          title={copy("Refresh inbox")}
          onClick={() => sync(true)}
          disabled={syncing || !canSync}>
          <RefreshCw
            className={cn("size-4", (syncing || autoSync.isFetching) && "motion-safe:animate-spin")}
            aria-hidden
          />
        </Button>
      </header>
      {(syncError || connection) && (
        <p role="status" className="mb-4 text-sm text-amber-600 dark:text-amber-300">
          {syncError ?? copy("The platform did not grant all inbox permissions.")}
        </p>
      )}
      <div className="mb-4 space-y-2">
        {accounts
          .filter((account) => account.error || account.permissionUrl)
          .map((account) => (
            <div
              key={account.id}
              className="flex flex-wrap items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm">
              <AlertTriangle className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />
              <PlatformIconBadge platform={account.platform} className="size-5" />
              <span className="min-w-48 flex-1">
                {account.name} · {account.error ?? copy("Reconnect to enable inbox activity.")}
              </span>
              {account.permissionUrl && canManage && (
                <Button asChild variant="outline" size="sm">
                  <Link href={reconnectHref(account.id, workspaceHref("/inbox", workspaceId), workspaceId)}>
                    {copy("Reconnect")}
                  </Link>
                </Button>
              )}
            </div>
          ))}
      </div>
      <section aria-label={copy("Inbox items")} className="rounded-xl border bg-card px-4 sm:px-5">
        <div id="inbox-filters" tabIndex={-1} className="flex flex-wrap items-center justify-between gap-2 py-3">
          <PlatformFilter
            platforms={platforms}
            selected={selectedPlatforms}
            onChange={(update) => setSelectedPlatforms((current) => update(current).sort())}
          />
          <Button
            size="sm"
            type="button"
            aria-pressed={needsReply}
            variant={needsReply ? "secondary" : "ghost"}
            onClick={() => setNeedsReply(!needsReply)}>
            {copy("Unanswered")}
          </Button>
        </div>
        {items.map((item, index) => (
          <InboxRow
            key={item.id}
            item={item}
            workspaceId={workspaceId}
            canManage={canManage}
            showAccount={(accountCounts.get(item.platform) ?? 0) > 1}
            refresh={refresh}
            focusNext={() => focusNext(index)}
          />
        ))}
        {items.length === 0 && (
          <div className="border-t border-border px-5 py-12 text-center text-sm text-muted-foreground">
            {feed.isPending || feed.isPlaceholderData ? (
              copy("Loading inbox…")
            ) : feed.isError ? (
              feed.error.message
            ) : accounts.length === 0 ? (
              <Link
                className="text-primary underline underline-offset-4"
                href={workspaceHref("/accounts", workspaceId)}>
                {copy("Manage accounts")}
              </Link>
            ) : !lastSync && autoSync.isFetching ? (
              copy("Checking for new activity…")
            ) : !lastSync && autoSync.isError ? (
              autoSync.error.message
            ) : (
              copy("No activity matches these filters.")
            )}
          </div>
        )}
        {feed.hasNextPage && !feed.isPlaceholderData && (
          <div className="border-t border-border p-3 text-center">
            <Button size="sm" variant="ghost" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
              {copy("Load more")}
            </Button>
          </div>
        )}
      </section>

      {showSyncMore && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={() => sync(false)} disabled={syncing}>
            {copy("Check older posts")}
          </Button>
        </div>
      )}
    </main>
  );
}
