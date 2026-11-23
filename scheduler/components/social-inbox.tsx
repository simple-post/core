"use client";

import { useState, type FormEvent } from "react";

import Link from "next/link";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, ChevronDown, Heart, Inbox, MessageSquare, RefreshCw, Send } from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { getPlatformById } from "@/components/visual/platforms";
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
  refresh,
  focusNext,
}: {
  item: SocialInboxItem;
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
  const [liked, setLiked] = useState(false);
  const initials = (item.author?.name ?? item.author?.username ?? "?")
    .trim()
    .split(/\s+/u)
    .slice(0, 2)
    .map((word) => [...word][0])
    .join("")
    .toUpperCase();
  const kind = item.kind === "quote" ? copy("Quote post") : item.kind === "reply" ? copy("Reply") : copy("Comment");
  const replyState = sent ? "sent" : item.reply?.status;
  const isLiked = liked || item.liked;
  const blocked = replyState === "pending" || replyState === "uncertain";
  const linkClass =
    "inline-flex min-h-8 items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary";
  const actionUrl = `${base}/items/${encodeURIComponent(item.id)}`;

  async function replyToItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim() || replying) return;
    const key = replyKey ?? crypto.randomUUID();
    setReplyKey(key);
    setReplying(true);
    setReplyFeedback(undefined);
    try {
      const receipt = await inboxRequest<Receipt>(`${actionUrl}/reply`, jsonPost({ body, idempotencyKey: key }));
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
      const receipt = await inboxRequest<Receipt>(`${actionUrl}/like`, { method: "PUT" });
      if (receipt.status === "sent") setLiked(true);
      else setLikeFeedback(receipt.errorMessage ?? copy("Check the platform to confirm your like."));
      await refresh();
    } catch (error) {
      setLikeFeedback(error instanceof Error ? error.message : copy("Could not like this item."));
    } finally {
      setLiking(false);
    }
  }

  return (
    <article className="group relative border-t border-border/75 px-4 py-5 sm:px-6" id={`inbox-${item.id}`}>
      <div className="flex items-start gap-3 sm:gap-4">
        <div
          aria-hidden
          className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-secondary font-mono text-xs font-semibold text-foreground">
          {initials}
          <PlatformIconBadge platform={item.platform} className="absolute -end-1.5 -bottom-1.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="max-w-full truncate text-sm font-semibold text-foreground">
              {item.author?.name ?? item.author?.username ?? copy("Unknown author")}
            </span>
            {item.author?.name && item.author.username && (
              <span className="truncate">
                {item.author.username.startsWith("@") ? "" : "@"}
                {item.author.username}
              </span>
            )}
            <span aria-hidden>·</span>
            <span>{platformLabel(item.platform)}</span>
            <time dateTime={item.createdAt} className="ms-auto shrink-0 font-mono text-[11px]">
              {new Intl.DateTimeFormat(locale, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(item.createdAt))}
            </time>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {kind} <span aria-hidden>·</span> {copy("To {{account}}", { account: item.accountName })}
          </div>
          <p className="mt-3 text-sm leading-6 wrap-anywhere whitespace-pre-wrap">
            {item.body || copy("This item has no text.")}
          </p>

          <div className="mt-3 flex items-center gap-2 rounded-e-md border-s-2 border-primary/55 bg-secondary/45 ps-3 pe-2">
            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{copy("Your post")}</span>
            <Link
              href={item.sourceUrl ?? `/posts/${encodeURIComponent(item.postId)}`}
              target={item.sourceUrl ? "_blank" : undefined}
              rel={item.sourceUrl ? "noreferrer" : undefined}
              className={cn(linkClass, "min-w-0 flex-1 justify-between")}>
              <span className="truncate">{item.sourceBody || copy("Open original post")}</span>
              <ArrowUpRight className="size-3 shrink-0" aria-hidden />
            </Link>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1 sm:gap-2">
            {item.canLike && (
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
            {item.canReply && !blocked && replyState !== "sent" && (
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
            {replyState === "sent" && <span className="px-2 text-xs text-primary">{copy("Replied")}</span>}
            {item.nativeUrl && (
              <a href={item.nativeUrl} className={cn(linkClass, "px-2")} target="_blank" rel="noreferrer">
                {copy("Open on platform")} <ArrowUpRight className="size-3" aria-hidden />
              </a>
            )}
          </div>

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
          {replyState === "sent" && item.reply && (
            <p className="mt-2 rounded-md border border-border p-2 text-xs text-muted-foreground wrap-anywhere">
              {item.reply.body}
              {item.reply.nativeReplyUrl && (
                <a className={cn(linkClass, "ms-2")} href={item.reply.nativeReplyUrl} target="_blank" rel="noreferrer">
                  {copy("View reply")}
                </a>
              )}
            </p>
          )}
          {open && !blocked && (
            <form onSubmit={replyToItem} className="mt-3 rounded-lg border border-border bg-background/50 p-2">
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
                <Button size="sm" disabled={replying || !body.trim()} className="gap-1.5">
                  <Send className="size-3.5" aria-hidden />
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
      </div>
    </article>
  );
}

export function SocialInbox({ connection }: { connection?: string | null }) {
  const { copy } = useUiCopy();
  const { data: session } = useSession();
  const [platform, setPlatform] = useState("");
  const [needsReply, setNeedsReply] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [syncError, setSyncError] = useState<string>();
  const queryClient = useQueryClient();
  const queryKey = ["social-inbox", session?.user.id];
  const feed = useInfiniteQuery({
    queryKey: [...queryKey, platform, needsReply],
    initialPageParam: "",
    queryFn: ({ pageParam }) => {
      const query = new URLSearchParams();
      if (platform) query.set("platform", platform);
      if (needsReply) query.set("needsReply", "true");
      if (pageParam) query.set("cursor", pageParam);
      return inboxRequest<InboxPage>(`${base}/inbox?${query}`);
    },
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
  });
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const accounts = feed.data?.pages[0]?.accounts ?? [];
  const platforms = [...new Set(accounts.map((account) => account.platform))].sort((a, b) =>
    platformLabel(a).localeCompare(platformLabel(b)),
  );
  const lastSync = accounts
    .map((account) => account.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const refresh = () => queryClient.invalidateQueries({ queryKey });

  async function sync(reset: boolean) {
    setSyncing(true);
    setSyncError(undefined);
    try {
      const result = await inboxRequest<{ hasMore: boolean }>(
        `${base}/inbox/refresh`,
        jsonPost({ reset, platform: platform || undefined }),
      );
      setHasMore(result.hasMore);
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
    if (button) {
      button.focus();
      button.click();
    } else document.querySelector<HTMLElement>("#inbox-filters")?.focus();
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pt-7 pb-16 sm:px-8 sm:pt-12">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-x-5 gap-y-4 sm:mb-9">
        <div>
          <div className="mb-3 grid size-10 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary">
            <Inbox className="size-5" aria-hidden />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-[2.75rem]">{copy("Inbox")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {copy("Replies, comments, and quotes on your published posts.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(hasMore || accounts.some((account) => account.hasMore && (!platform || platform === account.platform))) && (
            <Button type="button" variant="ghost" size="sm" onClick={() => sync(false)} disabled={syncing}>
              <ArrowDown className="size-4" aria-hidden />
              {copy("Sync more")}
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => sync(true)}
            disabled={
              syncing || !accounts.some((account) => account.canSync && (!platform || platform === account.platform))
            }>
            <RefreshCw className={cn("size-4", syncing && "motion-safe:animate-spin")} aria-hidden />
            {syncing ? copy("Refreshing…") : copy("Refresh inbox")}
          </Button>
        </div>
      </header>
      {(syncError || connection) && (
        <p role="status" className="mb-4 text-sm text-amber-300">
          {syncError ??
            (connection === "account"
              ? copy("Choose the same connected account when granting inbox permissions.")
              : copy("The platform did not grant all inbox permissions."))}
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-6">
        <section
          aria-label={copy("Inbox items")}
          className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div
            id="inbox-filters"
            tabIndex={-1}
            className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-5">
            <div className="flex gap-1 rounded-lg bg-background p-1">
              <Button
                size="sm"
                type="button"
                aria-pressed={!needsReply}
                variant={needsReply ? "ghost" : "secondary"}
                onClick={() => setNeedsReply(false)}>
                {copy("All activity")}
              </Button>
              <Button
                size="sm"
                type="button"
                aria-pressed={needsReply}
                variant={needsReply ? "secondary" : "ghost"}
                onClick={() => setNeedsReply(true)}>
                {copy("Needs reply")}
              </Button>
            </div>
            <label className="relative inline-flex items-center">
              <span className="sr-only">{copy("Filter by platform")}</span>
              <select
                value={platform}
                onChange={(event) => {
                  setPlatform(event.target.value);
                  setHasMore(false);
                }}
                className="h-9 appearance-none rounded-md border border-border bg-background ps-3 pe-8 text-sm focus-visible:outline-2 focus-visible:outline-primary">
                <option value="">{copy("All platforms")}</option>
                {platforms.map((item) => (
                  <option key={item} value={item}>
                    {platformLabel(item)}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute end-2 size-4 text-muted-foreground" aria-hidden />
            </label>
          </div>
          {items.map((item, index) => (
            <InboxRow key={item.id} item={item} refresh={refresh} focusNext={() => focusNext(index)} />
          ))}
          {items.length === 0 && (
            <div className="border-t border-border px-5 py-12 text-center text-sm text-muted-foreground">
              {feed.isPending
                ? copy("Loading inbox…")
                : feed.isError
                  ? feed.error.message
                  : lastSync
                    ? copy("No activity matches these filters.")
                    : copy("Refresh the inbox to check for activity on your published posts.")}
            </div>
          )}
          {feed.hasNextPage && (
            <div className="border-t border-border p-3 text-center">
              <Button size="sm" variant="ghost" onClick={() => feed.fetchNextPage()} disabled={feed.isFetchingNextPage}>
                {copy("Load more")}
              </Button>
            </div>
          )}
        </section>

        <aside
          aria-label={copy("Inbox connections")}
          className="min-w-0 rounded-xl border border-border bg-card/45 px-4 py-4">
          <h2 className="text-sm font-semibold">{copy("Connections")}</h2>
          {accounts.length === 0 && !feed.isPending && (
            <Link
              className="mt-2 inline-block text-xs text-primary underline-offset-4 hover:underline"
              href="/accounts">
              {copy("Manage accounts")}
            </Link>
          )}
          <ul className="mt-2 divide-y divide-border/70">
            {accounts.map((account) => (
              <li key={account.id} className="py-2.5">
                <div className="flex items-center gap-2">
                  <PlatformIconBadge platform={account.platform} />
                  <span className="truncate text-xs font-medium" title={account.name}>
                    {account.name}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-1 text-xs wrap-anywhere",
                    account.error ? "text-amber-300" : "text-muted-foreground",
                  )}>
                  {account.error ||
                    (account.canSync
                      ? account.lastSyncedAt
                        ? account.coverage || copy("Synced")
                        : copy("Ready to sync")
                      : copy("Inbox unavailable"))}
                </p>
                {account.permissionUrl && (
                  <a
                    className="mt-1 inline-block text-xs text-primary underline-offset-4 hover:underline"
                    href={account.permissionUrl}>
                    {copy("Grant inbox permissions")}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </main>
  );
}
