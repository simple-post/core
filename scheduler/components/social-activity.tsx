"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";

import { ExternalLink, LoaderCircle, MessageCircleReply, RefreshCw, Send } from "lucide-react";

import { PlatformIconBadge } from "@/components/platform-icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getPlatformById } from "@/lib/config";

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

function readableMetric(metric: string): string {
  return metric.replaceAll("_", " ").replaceAll(/([a-z])([A-Z])/g, "$1 $2");
}

function platformName(platform: string): string {
  return getPlatformById(platform)?.name ?? platform[0]?.toUpperCase() + platform.slice(1);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function timeLabel(value?: string): string {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function replyKey(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : `${Date.now()}${Math.random()}`.replaceAll(".", "");
}

function ReplyComposer({ item }: { item: ActivityItem }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [intentKey, setIntentKey] = useState(replyKey);
  const [attemptBody, setAttemptBody] = useState<string>();

  if (!item.canReply || item.reply?.status === "sent" || sent) {
    return item.reply?.status === "sent" || sent ? (
      <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-primary">Reply sent</p>
    ) : null;
  }

  if (item.reply?.status === "pending" || item.reply?.status === "uncertain") {
    return (
      <p className="mt-4 text-xs text-amber-300">
        {item.reply.status === "uncertain"
          ? "Reply status is uncertain. Check the native platform before sending another reply."
          : "Reply is being sent. Check the native platform before trying again."}
      </p>
    );
  }

  async function submit() {
    const body = draft.trim();
    if (!body) return;
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
      setSent(true);
    } catch (error_) {
      // Keep the composer contents so the person can edit or retry a rejected reply.
      setError(error_ instanceof Error ? error_.message : "Reply could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-3">
      <label className="sr-only" htmlFor={`reply-${item.id}`}>
        Reply to this {item.kind}
      </label>
      <Textarea
        id={`reply-${item.id}`}
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
        placeholder={`Reply as ${item.accountName}`}
        className="min-h-20 resize-y bg-input text-sm"
        maxLength={5000}
        disabled={sending}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-w-0 text-xs text-destructive" role="alert">
          {error}
        </p>
        <Button size="sm" onClick={submit} disabled={!draft.trim() || sending} className="shrink-0">
          {sending ? <LoaderCircle className="animate-spin" /> : <Send />}
          Send reply
        </Button>
      </div>
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

export function SocialActivityCard({ item }: { item: ActivityItem }) {
  const nativeUrl = externalUrl(item.nativeUrl);
  return (
    <article className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <PlatformIconBadge platform={item.platform} className="mt-0.5 size-7" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium">{item.author?.name || item.author?.username || "Social account"}</p>
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{item.kind}</span>
            <span className="text-xs text-muted-foreground">{timeLabel(item.createdAt)}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {item.accountName}
            {item.accountUsername ? ` · ${item.accountUsername}` : ""}
          </p>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
            {item.body || "No text"}
          </p>
          <div className="mt-3 flex items-center gap-3">
            {nativeUrl ? (
              <a
                href={nativeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-primary">
                <ExternalLink className="size-3" /> Visit native
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
          <ReplyComposer item={item} />
        </div>
      </div>
    </article>
  );
}

function Metrics({ metrics }: { metrics: MetricItem[] }) {
  if (metrics.length === 0)
    return (
      <p className="text-sm text-muted-foreground">Refresh this post to load metrics for platforms that expose them.</p>
    );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {metrics.map((metric) => {
        const nativeUrl = externalUrl(metric.nativeUrl);
        return (
          <section key={metric.id} className="rounded-xl border border-border bg-secondary/35 p-4">
            <div className="flex items-center gap-2">
              <PlatformIconBadge platform={metric.platform} />
              <p className="text-sm font-medium">{metric.accountName}</p>
              {nativeUrl ? (
                <a
                  href={nativeUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Visit ${metric.platform} post`}
                  className="ml-auto text-muted-foreground hover:text-primary">
                  <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </div>
            {metric.values && Object.keys(metric.values).length > 0 ? (
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                {Object.entries(metric.values).map(([name, value]) => (
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
                {metric.error || "No metrics available for this platform post."}
              </p>
            )}
            <p className="mt-4 text-xs text-muted-foreground">
              {metric.fetchedAt
                ? `Updated ${timeLabel(metric.fetchedAt)}`
                : `Last checked ${timeLabel(metric.lastAttemptAt)}`}
              {metric.coverage ? ` · ${metric.coverage}` : ""}
            </p>
            {metric.error && metric.values ? (
              <p className="mt-2 text-xs text-amber-300">Latest refresh: {metric.error}</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function PostSocialPanel({ postId, visible }: { postId: string; visible: boolean }) {
  const [data, setData] = useState<PostActivityResponse>();
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const load = useCallback(
    async (refresh = false, reset = false) => {
      if (!visible) return;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(undefined);
      try {
        const response = await fetch(`/api/v1/posts/${encodeURIComponent(postId)}/social${refresh ? "/refresh" : ""}`, {
          method: refresh ? "POST" : "GET",
          ...(refresh ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reset }) } : {}),
        });
        const payload = (await response.json()) as PostActivityResponse & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Social activity could not be loaded.");
        setData(payload);
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : "Social activity could not be loaded.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [postId, visible],
  );
  useEffect(() => {
    void load();
  }, [load]);
  if (!visible) return null;
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="section-kicker !mb-1">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Social activity</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Metrics stay separate by platform. Comments come from SimplePost-published posts.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void load(true, !data?.hasMoreComments)}
          disabled={refreshing}>
          {refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}{" "}
          {data?.hasMoreComments ? "Load more comments" : "Refresh"}
        </Button>
      </div>
      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {data?.errors?.length ? (
        <div className="mt-4 space-y-1 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3 text-xs text-amber-200">
          {data.errors.map((entry) => (
            <p key={`${entry.accountId}-${entry.message}`}>{entry.message}</p>
          ))}
        </div>
      ) : null}
      {data?.coverage?.length ? (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {data.coverage.map((entry) => (
            <p key={`${entry.accountId}-${entry.message}`}>
              {entry.platform}: {entry.message}
            </p>
          ))}
        </div>
      ) : null}
      {loading ? (
        <p className="mt-5 text-sm text-muted-foreground">Loading cached activity…</p>
      ) : (
        <>
          <div className="mt-5">
            <Metrics metrics={data?.metrics ?? []} />
          </div>
          <div className="mt-7 border-t border-border pt-5">
            <div className="flex items-center gap-2">
              <MessageCircleReply className="size-4 text-primary" />
              <h2 className="text-sm font-medium">Comments</h2>
            </div>
            <div className="mt-4 space-y-3">
              {data?.comments?.length ? (
                data.comments.map((item) => <SocialActivityCard key={item.id} item={item} />)
              ) : (
                <p className="text-sm text-muted-foreground">
                  No cached comments yet. Refresh to check connected platforms.
                </p>
              )}
            </div>
          </div>
        </>
      )}
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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>();
  const requestVersion = useRef(0);
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
      setLoading(true);
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
        if (version === requestVersion.current) setLoading(false);
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

  return (
    <main className="mx-auto max-w-4xl px-[clamp(18px,4vw,48px)] py-8 sm:py-6">
      <div className="animate-reveal flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="section-kicker">
            <span className="section-kicker-dot" />
            <span className="section-kicker-label">Social inbox</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Comments and mentions</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Across posts published with SimplePost and account-level mentions where the platform permits it.
          </p>
        </div>
        <Button size="sm" onClick={() => void refresh(true)} disabled={refreshing}>
          {refreshing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Refresh inbox
        </Button>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-2 border-y border-border py-3">
        <button
          className={`rounded-lg px-3 py-1.5 text-sm ${kind === "" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
          onClick={() => setKind("")}>
          All
        </button>
        <button
          className={`rounded-lg px-3 py-1.5 text-sm ${kind === "comment" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
          onClick={() => setKind("comment")}>
          Comments
        </button>
        <button
          className={`rounded-lg px-3 py-1.5 text-sm ${kind === "mention" ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
          onClick={() => setKind("mention")}>
          Mentions
        </button>
        <select
          aria-label="Filter by platform"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
          className="h-8 rounded-lg border border-border bg-input px-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All platforms</option>
          {PLATFORMS.map((name) => (
            <option key={name} value={name}>
              {platformName(name)}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by account"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          className="h-8 max-w-52 rounded-lg border border-border bg-input px-2 text-sm outline-none focus:ring-2 focus:ring-ring">
          <option value="">All accounts</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.displayName || account.username || account.platform} · {account.platform}
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {statuses.length > 0 ? (
        <div className="mt-4 rounded-xl border border-border bg-secondary/35 p-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              {statuses
                .map(
                  (status) =>
                    `${status.platform}: ${status.processed} comment target${status.processed === 1 ? "" : "s"}`,
                )
                .join(" · ")}
            </p>
            {hasMoreSync ? (
              <Button size="sm" variant="outline" onClick={() => void refresh(false)} disabled={refreshing}>
                Load older activity
              </Button>
            ) : (
              <p>Current sync complete</p>
            )}
          </div>
          {statuses
            .filter((status) => status.error)
            .map((status) => (
              <p key={`${status.accountId}-${status.error}`} className="mt-2 text-amber-300">
                {status.platform}: {status.error}
              </p>
            ))}
          {statuses
            .filter((status) => status.coverage)
            .map((status) => (
              <p key={`${status.accountId}-coverage`} className="mt-1">
                {status.platform}: {status.coverage}
              </p>
            ))}
        </div>
      ) : null}
      <div className="mt-5 space-y-3">
        {loading && items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading inbox…</p>
        ) : items.length > 0 ? (
          items.map((item) => <SocialActivityCard key={item.id} item={item} />)
        ) : (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <p className="text-sm font-medium">Nothing in the inbox yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Refresh checks newer activity. Load older activity continues through previous SimplePost posts.
            </p>
          </div>
        )}
      </div>
      {cursor ? (
        <div className="mt-5 text-center">
          <Button variant="outline" onClick={() => void load(true, cursor)} disabled={loading}>
            Load more
          </Button>
        </div>
      ) : null}
    </main>
  );
}
