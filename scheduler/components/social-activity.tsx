"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";

import {
  BarChart3,
  Check,
  ExternalLink,
  Inbox,
  LoaderCircle,
  MessageCircleReply,
  RefreshCw,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getPlatformById } from "@/lib/config";
import { cn } from "@/lib/utils";

export interface ActivityItem {
  id: string;
  kind: "comment" | "mention";
  platform: string;
  accountId: string;
  accountName: string;
  accountUsername?: string;
  postId?: string;
  nativeUrl?: string;
  nativePostId: string;
  body: string;
  createdAt?: string;
  author?: { id?: string; name?: string; username?: string; avatarUrl?: string };
  canReply: boolean;
  reply?: { status: string; body: string; nativeReplyUrl?: string; errorMessage?: string };
}

export interface MetricItem {
  id: string;
  platform: string;
  accountId: string;
  accountName: string;
  nativePostId: string;
  nativeUrl?: string;
  values?: Record<string, number>;
  coverage?: string;
  fetchedAt?: string;
  lastAttemptAt: string;
  error?: string;
}

interface PostActivityResponse {
  metrics: MetricItem[];
  comments: ActivityItem[];
  capabilities: Record<string, string[]>;
  hasMoreComments?: boolean;
  errors?: Array<{ accountId: string; message: string }>;
  coverage?: Array<{ accountId: string; platform: string; message: string }>;
}

interface InboxResponse {
  items: ActivityItem[];
  nextCursor?: string;
}

interface RefreshAccountStatus {
  accountId: string;
  platform: string;
  processed: number;
  mentionsProcessed?: boolean;
  hasMore: boolean;
  coverage?: string;
  error?: string;
}

interface InboxRefreshResponse {
  accounts: RefreshAccountStatus[];
  hasMore: boolean;
}

interface ConnectedAccountOption {
  id: string;
  platform: string;
  displayName?: string | null;
  username?: string | null;
}

const PLATFORMS = [
  "x",
  "facebook",
  "instagram",
  "threads",
  "linkedin",
  "tiktok",
  "youtube",
  "bluesky",
  "pinterest",
  "forem",
];

const ALL = "all";
/** Equal-width flex items would collapse below their label width, so keep each item content-sized. */
const KIND_TOGGLE_CLASS = "flex-none px-3 data-[state=on]:bg-secondary data-[state=on]:text-foreground";
const REPLY_MAX_LENGTH = 5000;

function readableMetric(metric: string): string {
  return metric.replaceAll("_", " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2");
}

function platformName(platform: string): string {
  const configured = getPlatformById(platform.toLowerCase())?.name;
  if (configured) return configured;
  return platform.charAt(0).toUpperCase() + platform.slice(1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function parseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function absoluteTime(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

function relativeTime(date: Date): string {
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  let amount = (date.getTime() - Date.now()) / 1000;
  for (const [unit, step] of RELATIVE_UNITS) {
    if (Math.abs(amount) < step) return formatter.format(Math.round(amount), unit);
    amount /= step;
  }
  return absoluteTime(date);
}

/** Relative label with the exact timestamp kept in the tooltip and in machine-readable form. */
function Timestamp({ value, className }: { value?: string; className?: string }) {
  const date = parseDate(value);
  if (!date) return null;
  return (
    <time dateTime={date.toISOString()} title={absoluteTime(date)} className={className}>
      {relativeTime(date)}
    </time>
  );
}

function Notice({
  tone = "warning",
  children,
  className,
}: {
  tone?: "warning" | "danger";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-xl border p-3 text-xs leading-5",
        tone === "danger"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        className,
      )}>
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

function externalUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function replyKey(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : `${Date.now()}${Math.random()}`.replaceAll(".", "");
}

function initials(name: string): string {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return letters || "?";
}

function handleLabel(username?: string): string | undefined {
  if (!username) return undefined;
  const trimmed = username.trim().replace(/^@/, "");
  return trimmed ? `@${trimmed}` : undefined;
}

function ReplyComposer({
  item,
  onSent,
  onCancel,
}: {
  item: ActivityItem;
  onSent: (body: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [intentKey, setIntentKey] = useState(replyKey);
  const [attemptBody, setAttemptBody] = useState<string>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  async function submit() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(undefined);
    setAttemptBody(body);
    try {
      const response = await fetch(`/api/v1/social/items/${encodeURIComponent(item.id)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, idempotencyKey: intentKey }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Reply could not be sent.");
      }
      setDraft("");
      setAttemptBody(undefined);
      setIntentKey(replyKey());
      onSent(body);
    } catch (error_) {
      // Keep the composer contents so the person can edit or retry a rejected reply.
      setError(error_ instanceof Error ? error_.message : "Reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  const remaining = REPLY_MAX_LENGTH - draft.length;
  return (
    <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
      <label className="sr-only" htmlFor={`reply-${item.id}`}>
        Reply to this {item.kind} as {item.accountName}
      </label>
      <Textarea
        id={`reply-${item.id}`}
        ref={textareaRef}
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value;
          if (attemptBody && nextDraft.trim() !== attemptBody) {
            setIntentKey(replyKey());
            setAttemptBody(undefined);
            setError(undefined);
          }
          setDraft(nextDraft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
        placeholder={`Reply as ${item.accountName}`}
        className="min-h-20 resize-y bg-input text-sm"
        maxLength={REPLY_MAX_LENGTH}
        disabled={sending}
      />
      {error ? (
        <p className="mt-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
        {remaining <= 500 ? (
          <p
            className={cn(
              "mr-auto text-xs tabular-nums",
              remaining < 0 ? "text-destructive" : "text-muted-foreground",
            )}>
            {formatNumber(remaining)} left
          </p>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={sending}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={!draft.trim() || sending}>
          {sending ? <LoaderCircle className="animate-spin" /> : <Send />}
          Send reply
        </Button>
      </div>
    </div>
  );
}

function ReplyState({ item, sentBody }: { item: ActivityItem; sentBody?: string }) {
  const status = sentBody ? "sent" : item.reply?.status;
  if (status === "sent") {
    const body = sentBody ?? item.reply?.body;
    const replyUrl = externalUrl(item.reply?.nativeReplyUrl);
    return (
      <div className="mt-3 rounded-xl border border-border bg-secondary/30 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <Check className="size-3.5" aria-hidden /> Reply sent
        </p>
        {body ? (
          <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{body}</p>
        ) : null}
        {replyUrl ? (
          <a
            href={replyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
            <ExternalLink className="size-3" aria-hidden /> View reply
          </a>
        ) : null}
      </div>
    );
  }
  if (status === "pending" || status === "uncertain") {
    return (
      <Notice className="mt-3">
        <p>
          {status === "uncertain"
            ? `This reply may or may not have been posted. Check ${platformName(item.platform)} before sending another one.`
            : `This reply is still sending. Check ${platformName(item.platform)} before trying again.`}
        </p>
      </Notice>
    );
  }
  return null;
}

export function SocialActivityCard({ item }: { item: ActivityItem }) {
  const [replying, setReplying] = useState(false);
  const [sentBody, setSentBody] = useState<string>();
  const nativeUrl = externalUrl(item.nativeUrl);
  const authorName = item.author?.name || item.author?.username || "Unknown author";
  const authorHandle = handleLabel(item.author?.username);
  const replyState = sentBody ? "sent" : item.reply?.status;
  // A failed reply can be retried; only a sent or in-flight one blocks the composer.
  const replyBlocked = replyState === "sent" || replyState === "pending" || replyState === "uncertain";
  const canReply = item.canReply && !replyBlocked;
  const previousFailure = replyState === "failed" ? item.reply?.errorMessage : undefined;

  return (
    <article className="rounded-2xl border border-border bg-card p-4 transition-colors hover:border-border/80 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar className="size-9">
            {item.author?.avatarUrl ? <AvatarImage src={item.author.avatarUrl} alt="" /> : null}
            <AvatarFallback className="text-xs font-medium text-muted-foreground">
              {initials(authorName)}
            </AvatarFallback>
          </Avatar>
          <PlatformIconBadge
            platform={item.platform}
            className="absolute -bottom-0.5 -right-0.5 size-4"
            iconClassName="text-[7px]"
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-sm font-medium">{authorName}</p>
            {authorHandle && authorHandle !== authorName ? (
              <span className="truncate text-xs text-muted-foreground">{authorHandle}</span>
            ) : null}
            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal capitalize">
              {item.kind}
            </Badge>
            <Timestamp value={item.createdAt} className="ml-auto shrink-0 text-xs text-muted-foreground" />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {platformName(item.platform)} · {item.accountName}
            {item.accountUsername ? ` (${handleLabel(item.accountUsername)})` : ""}
          </p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
            {item.body || <span className="text-muted-foreground">No text content</span>}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            {canReply && !replying ? (
              <Button size="sm" variant="outline" onClick={() => setReplying(true)}>
                <MessageCircleReply />
                Reply
              </Button>
            ) : null}
            {nativeUrl ? (
              <a
                href={nativeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
                <ExternalLink className="size-3" aria-hidden /> View on {platformName(item.platform)}
              </a>
            ) : null}
            {item.postId ? (
              <Link
                href={`/posts/${item.postId}`}
                className="text-xs text-muted-foreground transition-colors hover:text-primary">
                Open post
              </Link>
            ) : null}
          </div>
          {previousFailure ? (
            <Notice className="mt-3">
              <p>Previous reply failed: {previousFailure}</p>
            </Notice>
          ) : null}
          {replying ? (
            <ReplyComposer
              item={item}
              onSent={(body) => {
                setSentBody(body);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          ) : (
            <ReplyState item={item} sentBody={sentBody} />
          )}
        </div>
      </div>
    </article>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Skeleton className="size-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
    </div>
  );
}

function Metrics({ metrics }: { metrics: MetricItem[] }) {
  if (metrics.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No metrics cached yet. Refresh to pull the latest numbers from platforms that report them.
      </p>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {metrics.map((metric) => {
        const nativeUrl = externalUrl(metric.nativeUrl);
        const hasValues = Boolean(metric.values && Object.keys(metric.values).length > 0);
        return (
          <section key={metric.id} className="rounded-xl border border-border bg-secondary/35 p-4">
            <div className="flex items-center gap-2">
              <PlatformIconBadge platform={metric.platform} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{metric.accountName}</p>
                <p className="truncate text-xs text-muted-foreground">{platformName(metric.platform)}</p>
              </div>
              {nativeUrl ? (
                <a
                  href={nativeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View this post on ${platformName(metric.platform)}`}
                  className="text-muted-foreground transition-colors hover:text-primary">
                  <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : null}
            </div>
            {hasValues ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                {Object.entries(metric.values ?? {}).map(([name, value]) => (
                  <div key={name}>
                    <dt className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {readableMetric(name)}
                    </dt>
                    <dd className="mt-0.5 text-lg font-semibold tabular-nums">{formatNumber(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                {metric.error || "This platform does not report metrics for this post."}
              </p>
            )}
            <p className="mt-4 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
              {metric.fetchedAt ? "Updated" : "Last checked"}
              <Timestamp value={metric.fetchedAt ?? metric.lastAttemptAt} />
              {metric.coverage ? <span>· {metric.coverage}</span> : null}
            </p>
            {metric.error && hasValues ? (
              <Notice className="mt-3">
                <p>Latest refresh: {metric.error}</p>
              </Notice>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function SubsectionHeading({ icon: Icon, title, count }: { icon: typeof BarChart3; title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-primary" aria-hidden />
      <h3 className="text-sm font-medium">{title}</h3>
      {typeof count === "number" && count > 0 ? (
        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">
          {count}
        </Badge>
      ) : null}
    </div>
  );
}

export function PostSocialPanel({ postId }: { postId: string }) {
  const [data, setData] = useState<PostActivityResponse>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState<"latest" | "older" | undefined>();
  const [error, setError] = useState<string>();
  const load = useCallback(
    async (mode?: "latest" | "older") => {
      if (mode) setRefreshing(mode);
      else setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/social${mode ? "/refresh" : ""}`, {
          method: mode ? "POST" : "GET",
          ...(mode
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset: mode === "latest" }) }
            : {}),
        });
        const payload = (await response.json()) as PostActivityResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Social activity could not be loaded.");
        setData(payload);
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : "Social activity could not be loaded.");
      } finally {
        setLoading(false);
        setRefreshing(undefined);
      }
    },
    [postId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const busy = Boolean(refreshing);
  return (
    <section className="rounded-2xl border border-border bg-card p-6" aria-label="Social activity">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="section-kicker !mb-1">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Social activity</span>
          </h2>
          <p className="text-sm text-muted-foreground">
            Engagement and comments from the accounts this post was published to.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {data?.hasMoreComments ? (
            <Button size="sm" variant="ghost" onClick={() => void load("older")} disabled={busy}>
              {refreshing === "older" ? <LoaderCircle className="animate-spin" /> : null}
              Load older comments
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => void load("latest")} disabled={busy}>
            {refreshing === "latest" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            Refresh
          </Button>
        </div>
      </div>
      {error ? (
        <Notice tone="danger" className="mt-4">
          <p>{error}</p>
        </Notice>
      ) : null}
      {data?.errors?.length ? (
        <Notice className="mt-4">
          {data.errors.map((entry) => (
            <p key={`${entry.accountId}-${entry.message}`}>{entry.message}</p>
          ))}
        </Notice>
      ) : null}
      {data?.coverage?.length ? (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {data.coverage.map((entry) => (
            <p key={`${entry.accountId}-${entry.message}`}>
              {platformName(entry.platform)}: {entry.message}
            </p>
          ))}
        </div>
      ) : null}
      {loading ? (
        <div className="mt-5 space-y-3" aria-busy>
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5">
            <SubsectionHeading icon={BarChart3} title="Metrics" />
            <div className="mt-4">
              <Metrics metrics={data?.metrics ?? []} />
            </div>
          </div>
          <div className="mt-7 border-t border-border pt-5">
            <SubsectionHeading icon={MessageCircleReply} title="Comments" count={data?.comments?.length} />
            <div className={cn("mt-4 space-y-3 transition-opacity", busy && "opacity-60")}>
              {data?.comments?.length ? (
                data.comments.map((item) => <SocialActivityCard key={item.id} item={item} />)
              ) : (
                <p className="text-sm text-muted-foreground">
                  No comments cached yet. Refresh to check the connected platforms.
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SyncSummary({
  statuses,
  hasMore,
  refreshing,
  onLoadOlder,
  onDismiss,
}: {
  statuses: RefreshAccountStatus[];
  hasMore: boolean;
  refreshing: boolean;
  onLoadOlder: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="mt-4 rounded-xl border border-border bg-secondary/35 p-4" aria-label="Last sync">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Last sync</h2>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss sync summary"
          className="-m-1 rounded p-1 text-muted-foreground transition-colors hover:text-foreground">
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      <ul className="mt-3 space-y-2">
        {statuses.map((status) => (
          <li key={status.accountId} className="flex items-start gap-2 text-xs">
            <PlatformIconBadge platform={status.platform} className="mt-0.5 size-4" iconClassName="text-[7px]" />
            <div className="min-w-0 flex-1">
              <p className="text-foreground">
                <span className="font-medium">{platformName(status.platform)}</span>{" "}
                <span className="text-muted-foreground">
                  · {status.processed} post{status.processed === 1 ? "" : "s"} checked
                  {status.mentionsProcessed ? " · mentions checked" : ""}
                </span>
              </p>
              {status.coverage ? <p className="mt-0.5 text-muted-foreground">{status.coverage}</p> : null}
              {status.error ? <p className="mt-0.5 text-amber-700 dark:text-amber-300">{status.error}</p> : null}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-end border-t border-border pt-3">
        {hasMore ? (
          <Button size="sm" variant="outline" onClick={onLoadOlder} disabled={refreshing}>
            {refreshing ? <LoaderCircle className="animate-spin" /> : null}
            Load older activity
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Everything available has been synced.</p>
        )}
      </div>
    </section>
  );
}

export function SocialInbox() {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [kind, setKind] = useState<"" | "comment" | "mention">("");
  const [platform, setPlatform] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<ConnectedAccountOption[]>([]);
  const [statuses, setStatuses] = useState<RefreshAccountStatus[]>([]);
  const [hasMoreSync, setHasMoreSync] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const requestVersion = useRef(0);
  const hasFilters = Boolean(kind || platform || accountId);
  const query = useMemo(
    () =>
      new URLSearchParams({
        ...(kind ? { kind } : {}),
        ...(platform ? { platform } : {}),
        ...(accountId ? { accountId } : {}),
      }),
    [accountId, kind, platform],
  );

  const load = useCallback(
    async (append = false, pageCursor?: string) => {
      const version = ++requestVersion.current;
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(undefined);
      try {
        const params = new URLSearchParams(query);
        if (append && pageCursor) params.set("cursor", pageCursor);
        const response = await fetch(`/api/v1/social/inbox?${params}`);
        const payload = (await response.json()) as InboxResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Inbox could not be loaded.");
        if (version !== requestVersion.current) return;
        setItems((current) => (append ? [...current, ...payload.items] : payload.items));
        setCursor(payload.nextCursor);
      } catch (error_) {
        if (version === requestVersion.current)
          setError(error_ instanceof Error ? error_.message : "Inbox could not be loaded.");
      } finally {
        if (version === requestVersion.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [query],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/v1/accounts");
        const payload = (await response.json()) as { accounts?: ConnectedAccountOption[] };
        if (active && response.ok) setAccounts(payload.accounts ?? []);
      } catch {
        // Filters remain usable when account labels cannot be loaded.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Offer only platforms the person actually has connected, falling back to the full list.
  const platformOptions = useMemo(() => {
    const connected = new Set(accounts.map((account) => account.platform.toLowerCase()));
    if (platform) connected.add(platform);
    const available = PLATFORMS.filter((name) => connected.has(name));
    return available.length > 0 ? available : PLATFORMS;
  }, [accounts, platform]);

  async function refresh(reset: boolean) {
    setRefreshing(true);
    setError(undefined);
    try {
      const response = await fetch("/api/v1/social/inbox/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeMentions: true, reset }),
      });
      const payload = (await response.json()) as InboxRefreshResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Inbox sync could not start.");
      setStatuses(payload.accounts);
      setHasMoreSync(payload.hasMore);
      await load();
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Inbox sync could not start.");
    } finally {
      setRefreshing(false);
    }
  }

  function clearFilters() {
    setKind("");
    setPlatform("");
    setAccountId("");
  }

  return (
    <main className="mx-auto max-w-4xl px-[clamp(18px,4vw,48px)] py-6">
      <div className="animate-reveal flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Inbox</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              Comments and <span className="text-primary">mentions</span>
            </h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Replies to posts you published with SimplePost, plus account mentions where the platform allows it.
          </p>
        </div>
        <Button size="sm" onClick={() => void refresh(true)} disabled={refreshing} className="shrink-0">
          {refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Refresh
        </Button>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-y border-border py-3">
        <ToggleGroup
          type="single"
          value={kind || ALL}
          onValueChange={(value) => {
            if (value) setKind(value === ALL ? "" : (value as "comment" | "mention"));
          }}
          variant="outline"
          size="sm"
          aria-label="Filter by type">
          <ToggleGroupItem value={ALL} className={KIND_TOGGLE_CLASS}>
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="comment" className={KIND_TOGGLE_CLASS}>
            Comments
          </ToggleGroupItem>
          <ToggleGroupItem value="mention" className={KIND_TOGGLE_CLASS}>
            Mentions
          </ToggleGroupItem>
        </ToggleGroup>
        <Select value={platform || ALL} onValueChange={(value) => setPlatform(value === ALL ? "" : value)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Filter by platform">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All platforms</SelectItem>
            {platformOptions.map((name) => (
              <SelectItem key={name} value={name}>
                {platformName(name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={accountId || ALL} onValueChange={(value) => setAccountId(value === ALL ? "" : value)}>
          <SelectTrigger size="sm" className="w-44" aria-label="Filter by account">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All accounts</SelectItem>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.displayName || account.username || platformName(account.platform)} ·{" "}
                {platformName(account.platform)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters ? (
          <Button size="sm" variant="ghost" onClick={clearFilters} className="text-muted-foreground">
            Clear filters
          </Button>
        ) : null}
      </div>

      {error ? (
        <Notice tone="danger" className="mt-4">
          <p>{error}</p>
        </Notice>
      ) : null}

      {statuses.length > 0 ? (
        <SyncSummary
          statuses={statuses}
          hasMore={hasMoreSync}
          refreshing={refreshing}
          onLoadOlder={() => void refresh(false)}
          onDismiss={() => setStatuses([])}
        />
      ) : null}

      <div
        className={cn("mt-5 space-y-3 transition-opacity", loading && items.length > 0 && "opacity-60")}
        aria-busy={loading}>
        {loading && items.length === 0 ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : items.length > 0 ? (
          items.map((item) => <SocialActivityCard key={item.id} item={item} />)
        ) : hasFilters ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <p className="text-sm font-medium">No activity matches these filters</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
              Try a different type, platform, or account.
            </p>
            <Button size="sm" variant="outline" onClick={clearFilters} className="mt-5">
              Clear filters
            </Button>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center">
            <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-lg border border-border bg-secondary">
              <Inbox className="size-5 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-sm font-medium">Nothing in your inbox yet</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
              Refresh to check your connected accounts for new comments and mentions.
            </p>
            <Button size="sm" onClick={() => void refresh(true)} disabled={refreshing} className="mt-5">
              {refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              Refresh
            </Button>
          </div>
        )}
      </div>

      {cursor && items.length > 0 ? (
        <div className="mt-5 text-center">
          <Button variant="outline" onClick={() => void load(true, cursor)} disabled={loading || loadingMore}>
            {loadingMore ? <LoaderCircle className="animate-spin" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </main>
  );
}
