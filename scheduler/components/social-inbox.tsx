"use client";

import { useRef, useState, type FormEvent } from "react";

import Link from "next/link";

import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUpRight, ChevronDown, Ellipsis, Heart, MessageSquare, RefreshCw, Users } from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  showAccount,
  refresh,
  focusNext,
}: {
  item: SocialInboxItem;
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
  const [liked, setLiked] = useState(false);
  const [showSentReply, setShowSentReply] = useState(false);
  const author = item.author?.name || item.author?.username || copy("Unknown author");
  const kind = item.kind === "quote" ? copy("Quote post") : item.kind === "reply" ? copy("Reply") : copy("Comment");
  const replyState = sent ? "sent" : item.reply?.status;
  const isLiked = liked || item.liked;
  const blocked = replyState === "pending" || replyState === "uncertain";
  const sourceHref = item.sourceUrl ?? `/posts/${encodeURIComponent(item.postId)}`;
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
              {replyState === "sent" && <span className="px-2 text-xs">{copy("Replied")}</span>}
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
                <Link
                  href={sourceHref}
                  target={item.sourceUrl ? "_blank" : undefined}
                  rel={item.sourceUrl ? "noreferrer" : undefined}
                  title={item.sourceBody}
                  className="max-w-full truncate underline underline-offset-2 hover:text-foreground">
                  {copy("Open original post")}
                </Link>
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="-mt-1 size-8 shrink-0 text-muted-foreground"
              aria-label={`${copy("More actions")} · ${author}`}>
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {item.nativeUrl && (
              <DropdownMenuItem asChild>
                <a href={item.nativeUrl} target="_blank" rel="noreferrer">
                  <ArrowUpRight aria-hidden />
                  {copy("Open on platform")}
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem asChild>
              <Link
                href={sourceHref}
                target={item.sourceUrl ? "_blank" : undefined}
                rel={item.sourceUrl ? "noreferrer" : undefined}
                title={item.sourceBody}>
                <ArrowUpRight aria-hidden />
                {copy("Open original post")}
              </Link>
            </DropdownMenuItem>
            {replyState === "sent" && item.reply && (
              <DropdownMenuItem onSelect={() => setShowSentReply((current) => !current)}>
                <MessageSquare aria-hidden />
                {showSentReply ? copy("Hide reply") : copy("View reply")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
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
  const [showConnections, setShowConnections] = useState(false);
  const inboxMenu = useRef<HTMLButtonElement>(null);
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
  const accountCounts = new Map<string, number>();
  for (const account of accounts) {
    accountCounts.set(account.platform, (accountCounts.get(account.platform) ?? 0) + 1);
  }
  const platforms = [...accountCounts.keys()].sort((a, b) => platformLabel(a).localeCompare(platformLabel(b)));
  const lastSync = accounts
    .map((account) => account.lastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  const visibleAccounts = platform ? accounts.filter((account) => account.platform === platform) : accounts;
  const canSync = visibleAccounts.some((account) => account.canSync);
  const showSyncMore = hasMore || visibleAccounts.some((account) => account.hasMore);
  const connectionHasError = accounts.some((account) => account.error);
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
    if (button?.getAttribute("aria-expanded") === "true") {
      button.closest("article")?.querySelector("textarea")?.focus();
    } else if (button) {
      button.click();
    } else {
      document.querySelector<HTMLElement>("#inbox-filters")?.focus();
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pt-7 pb-16 sm:px-8 sm:pt-10">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{copy("Inbox")}</h1>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={syncing ? copy("Refreshing…") : copy("Refresh inbox")}
            title={copy("Refresh inbox")}
            onClick={() => sync(true)}
            disabled={syncing || !canSync}
            className="text-muted-foreground">
            <RefreshCw className={cn("size-4", syncing && "motion-safe:animate-spin")} aria-hidden />
          </Button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={inboxMenu}
                type="button"
                variant="ghost"
                size="icon"
                aria-label={copy("Inbox options")}
                className="relative text-muted-foreground">
                <Ellipsis aria-hidden />
                {connectionHasError && (
                  <span className="absolute end-1.5 top-1.5 size-1.5 rounded-full bg-amber-300" aria-hidden />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setShowConnections(true)}>
                <Users aria-hidden />
                {copy("Connections")}
              </DropdownMenuItem>
              {showSyncMore && (
                <DropdownMenuItem onSelect={() => sync(false)} disabled={syncing}>
                  <ArrowDown aria-hidden />
                  {copy("Sync more")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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

      <section aria-label={copy("Inbox items")}>
        <div id="inbox-filters" tabIndex={-1} className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
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
          <Button
            size="sm"
            type="button"
            aria-pressed={needsReply}
            variant={needsReply ? "secondary" : "ghost"}
            onClick={() => setNeedsReply(!needsReply)}>
            {copy("Needs reply")}
          </Button>
        </div>
        {items.map((item, index) => (
          <InboxRow
            key={item.id}
            item={item}
            showAccount={(accountCounts.get(item.platform) ?? 0) > 1}
            refresh={refresh}
            focusNext={() => focusNext(index)}
          />
        ))}
        {items.length === 0 && (
          <div className="border-t border-border px-5 py-12 text-center text-sm text-muted-foreground">
            {feed.isPending ? (
              copy("Loading inbox…")
            ) : feed.isError ? (
              feed.error.message
            ) : accounts.length === 0 ? (
              <Link className="text-primary underline underline-offset-4" href="/accounts">
                {copy("Manage accounts")}
              </Link>
            ) : canSync ? (
              lastSync ? (
                copy("No activity matches these filters.")
              ) : (
                copy("Refresh the inbox to check for activity on your published posts.")
              )
            ) : (
              copy("Inbox unavailable")
            )}
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

      <Dialog open={showConnections} onOpenChange={setShowConnections}>
        <DialogContent
          aria-describedby={undefined}
          className="max-h-[80dvh] overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            inboxMenu.current?.focus();
          }}>
          <DialogHeader>
            <DialogTitle>{copy("Inbox connections")}</DialogTitle>
          </DialogHeader>
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
        </DialogContent>
      </Dialog>
    </main>
  );
}
