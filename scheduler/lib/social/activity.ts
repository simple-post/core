import {
  getSocialActivityCapabilities,
  getSocialPostMetrics,
  listSocialMentions,
  listSocialPostComments,
  replyToSocialComment,
} from "@simple-post/sdk";

import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/utils/errors";
import type { AccountPublishResult, ConnectedAccount } from "@/types";

import type { Prisma } from "@prisma/client";
import type { SocialActivityAccount, SocialComment, SocialMention } from "@simple-post/sdk";

const ACTIVITY_CACHE_MS = 15 * 60 * 1000;
const MAX_REPLY_LENGTH = 5000;
const MAX_TARGETS_PER_REFRESH = 8;
const MAX_TARGETS_PER_REQUEST = 12;
const POSTS_PER_SNAPSHOT = 25;
const MAX_CURSOR_LENGTH = 2048;
const MAX_ACTIVITY_BODY_LENGTH = 10_000;
const MENTION_COMPLETE_CURSOR = "__complete__";

export type SocialActivityKind = "comment" | "mention";

export interface SocialActivityView {
  id: string;
  kind: SocialActivityKind;
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

export interface SocialMetricView {
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

export interface SocialRefreshStatus {
  accountId: string;
  platform: string;
  processed: number;
  hasMore: boolean;
  mentionsProcessed?: boolean;
  coverage?: string;
  error?: string;
}

interface OwnedTarget {
  key: string;
  postId: string;
  account: ConnectedAccount;
  nativePostId: string;
  nativeUrl?: string;
  platformData?: Record<string, unknown>;
  publishedAt?: string;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function date(value: string | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => (character.codePointAt(0) ?? 0) < 32);
}

function isUsableNativeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1000 && !hasControlCharacter(value);
}

function safeNativeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function accountName(account: ConnectedAccount): string {
  return account.displayName || account.username || "Connected account";
}

function socialAccount(account: ConnectedAccount): SocialActivityAccount {
  return {
    platform: account.platform,
    accountId: account.id,
    platformAccountId: account.platformAccountId,
    accessToken: account.accessToken,
    username: account.username ?? undefined,
    credentials: object(account.tokenMetadata),
  };
}

function targetFromResult(
  postId: string,
  account: ConnectedAccount,
  result: AccountPublishResult,
  publishedAt?: Date | null,
): OwnedTarget | null {
  if (!result.success || !isUsableNativeId(result.postId)) return null;
  const platform = account.platform.toLowerCase();
  const data = object(result.platformData);
  // TikTok's publishing API can return a task/inbox ID before a real public
  // video exists. Do not ask Display API to treat either one as a video ID.
  if (platform === "tiktok" && (data.publishMode === "draft" || data.status === "PROCESSING" || !result.postUrl))
    return null;
  return {
    key: `${account.id}:${result.postId}`,
    postId,
    account,
    nativePostId: result.postId,
    nativeUrl: result.postUrl,
    platformData: data,
    publishedAt: publishedAt?.toISOString(),
  };
}

function targetsFromPosts(
  posts: Array<{
    id: string;
    publishedAt: Date | null;
    accountResults: unknown;
    threadResults: unknown;
    accounts: Array<ConnectedAccount & { tokenMetadata: Prisma.JsonValue | null }>;
  }>,
): OwnedTarget[] {
  const targets: OwnedTarget[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    const results = object(post.accountResults) as Record<string, AccountPublishResult>;
    const accounts = new Map(post.accounts.map((account) => [account.id, decryptConnectedAccountSecrets(account)]));
    for (const result of Object.values(results)) {
      const account = accounts.get(result.accountId);
      if (!account) continue;
      const target = targetFromResult(post.id, account, result, post.publishedAt);
      if (target && !seen.has(target.key)) {
        targets.push(target);
        seen.add(target.key);
      }
      const threadResults = object(post.threadResults)[result.accountId];
      if (!Array.isArray(threadResults)) continue;
      for (const segment of threadResults) {
        const entry = object(segment);
        if (!entry.success || !isUsableNativeId(entry.postId)) continue;
        const segmentTarget = targetFromResult(
          post.id,
          account,
          {
            ...result,
            success: true,
            postId: entry.postId,
            postUrl: typeof entry.postUrl === "string" ? entry.postUrl : result.postUrl,
            platformData: object(entry.platformData),
          },
          post.publishedAt,
        );
        if (segmentTarget && !seen.has(segmentTarget.key)) {
          targets.push(segmentTarget);
          seen.add(segmentTarget.key);
        }
      }
    }
  }
  return targets;
}

/**
 * Resolves only native targets originating in the user's own SimplePost
 * publish records. Browser input never participates in provider lookup.
 */
async function ownedTargets(userId: string, postId?: string): Promise<OwnedTarget[]> {
  const posts = await prisma.post.findMany({
    where: { userId, ...(postId ? { id: postId } : {}) },
    include: { accounts: true },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
  });
  return targetsFromPosts(posts);
}

function encodePostCursor(post: { createdAt: Date; id: string }): string {
  return Buffer.from(`${post.createdAt.toISOString()}|${post.id}`).toString("base64url");
}

function decodePostCursor(value: string | undefined): { createdAt: Date; id: string } | undefined {
  if (!value || value.length > MAX_CURSOR_LENGTH) return undefined;
  const [createdAtText, id] = Buffer.from(value, "base64url").toString("utf8").split("|");
  const createdAt = createdAtText ? new Date(createdAtText) : undefined;
  return createdAt && Number.isFinite(createdAt.getTime()) && id ? { createdAt, id } : undefined;
}

/**
 * Pull a small, keyset-paginated batch of saved posts. The resulting targets
 * are snapshot below, so a later refresh never has to rescan the whole post
 * history to resume a provider comment cursor.
 */
async function ownedTargetPage(userId: string, after?: string) {
  const cursor = decodePostCursor(after);
  const posts = await prisma.post.findMany({
    where: {
      userId,
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
        : {}),
    },
    include: { accounts: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: POSTS_PER_SNAPSHOT + 1,
  });
  const page = posts.slice(0, POSTS_PER_SNAPSHOT);
  const last = page.at(-1);
  return {
    targets: targetsFromPosts(page),
    nextPostCursor: posts.length > POSTS_PER_SNAPSHOT && last ? encodePostCursor(last) : undefined,
  };
}

async function refreshedAccount(userId: string, accountId: string): Promise<ConnectedAccount> {
  const stored = await prisma.connectedAccount.findFirst({ where: { id: accountId, userId } });
  if (!stored) throw new NotFoundError("Connected account not found");
  const decrypted = decryptConnectedAccountSecrets(stored);
  const result = await withAccountLock(accountId, async () => {
    const latest = await reloadAccountSecrets(decrypted);
    return refreshConnectedAccountIfNeeded(latest, { reason: "manual" });
  });
  if (result.error) throw new BadRequestError(result.error);
  return result.account;
}

async function saveItems(
  userId: string,
  account: ConnectedAccount,
  kind: SocialActivityKind,
  postId: string | undefined,
  items: SocialComment[] | SocialMention[],
): Promise<void> {
  for (const item of items) {
    if (!isUsableNativeId(item.nativeId) || !isUsableNativeId(item.nativePostId)) continue;
    const nativeUrl = safeNativeUrl(item.nativeUrl);
    await prisma.socialActivityItem.upsert({
      where: { accountId_kind_nativeId: { accountId: account.id, kind, nativeId: item.nativeId } },
      create: {
        userId,
        accountId: account.id,
        postId,
        platform: account.platform,
        kind,
        nativeId: item.nativeId,
        nativePostId: item.nativePostId,
        nativeUrl,
        body: item.body.slice(0, MAX_ACTIVITY_BODY_LENGTH),
        author: boundedJson(item.author) as Prisma.InputJsonValue | undefined,
        providerData: boundedJson(item.replyTarget) as Prisma.InputJsonValue | undefined,
        createdAtNative: date(item.createdAt) ?? undefined,
        canReply: item.canReply,
      },
      update: {
        postId: postId ?? undefined,
        nativePostId: item.nativePostId,
        nativeUrl,
        body: item.body.slice(0, MAX_ACTIVITY_BODY_LENGTH),
        author: boundedJson(item.author) as Prisma.InputJsonValue | undefined,
        providerData: boundedJson(item.replyTarget) as Prisma.InputJsonValue | undefined,
        createdAtNative: date(item.createdAt) ?? undefined,
        canReply: item.canReply,
        lastSeenAt: new Date(),
      },
    });
  }
}

function boundedJson(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const limit = (entry: unknown, depth: number): unknown => {
    if (typeof entry === "string") return entry.slice(0, 1000);
    if (typeof entry === "number" || typeof entry === "boolean" || entry === null) return entry;
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || depth >= 2) return undefined;
    return Object.fromEntries(
      Object.entries(entry as Record<string, unknown>)
        .slice(0, 12)
        .flatMap(([key, nested]) => {
          const limited = limit(nested, depth + 1);
          return limited === undefined ? [] : [[key, limited]];
        }),
    );
  };
  const copy = limit(value, 0) as Record<string, unknown>;
  return Object.keys(copy).length > 0 ? copy : undefined;
}

function safeProviderCursor(value: string | undefined): string | undefined {
  return value && value.length <= MAX_CURSOR_LENGTH && !hasControlCharacter(value) ? value : undefined;
}

function cursorMap(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(object(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(safeProviderCursor(entry[1])),
    ),
  );
}

interface TargetSnapshot {
  targets: Array<Pick<OwnedTarget, "key" | "postId" | "nativePostId" | "nativeUrl" | "platformData" | "publishedAt">>;
  nextPostCursor?: string;
}

function targetSnapshot(value: unknown): TargetSnapshot {
  const stored = object(value);
  const rawTargets = Array.isArray(stored.targets) ? stored.targets : [];
  const targets = rawTargets.flatMap((entry) => {
    const target = object(entry);
    if (!isUsableNativeId(target.postId) || !isUsableNativeId(target.nativePostId) || typeof target.key !== "string")
      return [];
    return [
      {
        key: target.key.slice(0, 2100),
        postId: target.postId,
        nativePostId: target.nativePostId,
        nativeUrl: typeof target.nativeUrl === "string" ? safeNativeUrl(target.nativeUrl) : undefined,
        platformData: boundedJson(target.platformData),
        publishedAt: typeof target.publishedAt === "string" ? target.publishedAt : undefined,
      },
    ];
  });
  return {
    targets,
    nextPostCursor:
      typeof stored.nextPostCursor === "string" && decodePostCursor(stored.nextPostCursor)
        ? stored.nextPostCursor
        : undefined,
  };
}

function serializeTargetSnapshot(targets: OwnedTarget[], nextPostCursor?: string): TargetSnapshot {
  return {
    targets: targets.map(({ key, postId, nativePostId, nativeUrl, platformData, publishedAt }) => ({
      key,
      postId,
      nativePostId,
      nativeUrl: safeNativeUrl(nativeUrl),
      platformData: boundedJson(platformData),
      publishedAt,
    })),
    nextPostCursor,
  };
}

function restoreTarget(account: ConnectedAccount, target: TargetSnapshot["targets"][number]): OwnedTarget {
  return { ...target, account };
}

function hasPendingAccountSync(
  sync:
    | { targetSnapshot: unknown; targetIndex: number; commentCursors: unknown; mentionCursor: string | null }
    | undefined,
  platform: string,
  includeMentions: boolean | undefined,
): boolean {
  if (!sync) return true;
  const stored = targetSnapshot(sync.targetSnapshot);
  const hasMoreComments =
    sync.targetIndex < stored.targets.length ||
    Object.keys(cursorMap(sync.commentCursors)).length > 0 ||
    Boolean(stored.nextPostCursor);
  const hasMoreMentions =
    Boolean(includeMentions) &&
    getSocialActivityCapabilities(platform).has("mentions") &&
    sync.mentionCursor !== MENTION_COMPLETE_CURSOR;
  return hasMoreComments || hasMoreMentions;
}

async function refreshTargetMetrics(userId: string, target: OwnedTarget, force: boolean): Promise<void> {
  const cached = await prisma.socialPostMetric.findUnique({
    where: { accountId_nativePostId: { accountId: target.account.id, nativePostId: target.nativePostId } },
  });
  if (!force && cached?.fetchedAt && Date.now() - cached.fetchedAt.getTime() < ACTIVITY_CACHE_MS) return;
  const account = await refreshedAccount(userId, target.account.id);
  const response = await getSocialPostMetrics(socialAccount(account), {
    nativePostId: target.nativePostId,
    nativeUrl: target.nativeUrl,
    platformData: target.platformData,
    publishedAt: target.publishedAt,
  });
  const attemptedAt = new Date();
  if (response.ok) {
    await prisma.socialPostMetric.upsert({
      where: { accountId_nativePostId: { accountId: account.id, nativePostId: target.nativePostId } },
      create: {
        userId,
        accountId: account.id,
        postId: target.postId,
        platform: account.platform,
        nativePostId: target.nativePostId,
        nativeUrl: target.nativeUrl,
        values: response.data.values,
        coverage: response.data.coverage,
        fetchedAt: attemptedAt,
        lastAttemptAt: attemptedAt,
      },
      update: {
        values: response.data.values,
        coverage: response.data.coverage,
        nativeUrl: target.nativeUrl,
        fetchedAt: attemptedAt,
        lastAttemptAt: attemptedAt,
        errorCode: null,
        errorMessage: null,
      },
    });
    return;
  }
  await prisma.socialPostMetric.upsert({
    where: { accountId_nativePostId: { accountId: account.id, nativePostId: target.nativePostId } },
    create: {
      userId,
      accountId: account.id,
      postId: target.postId,
      platform: account.platform,
      nativePostId: target.nativePostId,
      nativeUrl: target.nativeUrl,
      lastAttemptAt: attemptedAt,
      errorCode: response.error.code,
      errorMessage: response.error.message,
    },
    update: { lastAttemptAt: attemptedAt, errorCode: response.error.code, errorMessage: response.error.message },
  });
}

async function recordMetricAttemptFailure(userId: string, target: OwnedTarget, message: string): Promise<void> {
  const attemptedAt = new Date();
  await prisma.socialPostMetric.upsert({
    where: { accountId_nativePostId: { accountId: target.account.id, nativePostId: target.nativePostId } },
    create: {
      userId,
      accountId: target.account.id,
      postId: target.postId,
      platform: target.account.platform,
      nativePostId: target.nativePostId,
      nativeUrl: target.nativeUrl,
      lastAttemptAt: attemptedAt,
      errorCode: "refresh_failed",
      errorMessage: message,
    },
    update: { lastAttemptAt: attemptedAt, errorCode: "refresh_failed", errorMessage: message },
  });
}

export async function getPostSocialActivity(userId: string, postId: string) {
  const targets = await ownedTargets(userId, postId);
  if (targets.length === 0) throw new NotFoundError("No SimplePost-published platform posts were found");
  const [metrics, items, syncs] = await Promise.all([
    prisma.socialPostMetric.findMany({
      where: { userId, postId },
      include: { account: true },
      orderBy: { fetchedAt: "desc" },
    }),
    prisma.socialActivityItem.findMany({
      where: { userId, postId },
      include: { account: true, replies: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ createdAtNative: "desc" }, { firstSeenAt: "desc" }],
    }),
    prisma.socialActivitySync.findMany({
      where: { accountId: { in: [...new Set(targets.map((target) => target.account.id))] } },
    }),
  ]);
  const cursors = new Map(syncs.map((sync) => [sync.accountId, cursorMap(sync.commentCursors)]));
  const refreshedTargets = new Set(metrics.map((metric) => `${metric.accountId}:${metric.nativePostId}`));
  return {
    metrics: metrics.map((metric) => metricView(metric)),
    comments: items.filter((item) => item.kind === "comment").map((item) => activityView(item)),
    capabilities: Object.fromEntries(
      targets.map((target) => [target.account.id, [...getSocialActivityCapabilities(target.account.platform)]]),
    ),
    hasMoreComments:
      targets.some((target) => Boolean(cursors.get(target.account.id)?.[target.key])) ||
      targets.some((target) => !refreshedTargets.has(target.key)) ||
      syncs.some((sync) => sync.lastError?.includes("continuation cursor")),
  };
}

/** Refresh the visible post detail without advancing the account-wide inbox traversal. */
export async function refreshPostSocialActivity(userId: string, postId: string, options: { reset?: boolean } = {}) {
  const targets = await ownedTargets(userId, postId);
  if (targets.length === 0) throw new NotFoundError("No SimplePost-published platform posts were found");
  const refreshed = await prisma.socialPostMetric.findMany({
    where: { userId, postId },
    select: { accountId: true, nativePostId: true, lastAttemptAt: true },
  });
  const refreshedByTarget = new Map(refreshed.map((metric) => [`${metric.accountId}:${metric.nativePostId}`, metric]));
  const candidates = targets.filter((target) => !refreshedByTarget.has(target.key));
  const targetsToRefresh = (
    candidates.length > 0
      ? candidates
      : [...targets].sort(
          (left, right) =>
            (refreshedByTarget.get(left.key)?.lastAttemptAt.getTime() ?? 0) -
            (refreshedByTarget.get(right.key)?.lastAttemptAt.getTime() ?? 0),
        )
  ).slice(0, MAX_TARGETS_PER_REQUEST);
  const errors: Array<{ accountId: string; message: string }> = [];
  const coverage: Array<{ accountId: string; platform: string; message: string }> = [];
  for (const target of targetsToRefresh) {
    try {
      await refreshTargetMetrics(userId, target, true);
    } catch {
      const message = `${target.account.platform} metrics could not be refreshed. Cached values are still shown.`;
      await recordMetricAttemptFailure(userId, target, message).catch(() => undefined);
      errors.push({
        accountId: target.account.id,
        message,
      });
    }
    try {
      const fresh = await refreshedAccount(userId, target.account.id);
      if (!getSocialActivityCapabilities(fresh.platform).has("comments")) {
        errors.push({
          accountId: fresh.id,
          message: `${fresh.platform} comments are unavailable for this connection.`,
        });
        continue;
      }
      const sync = await prisma.socialActivitySync.upsert({
        where: { accountId: fresh.id },
        create: { accountId: fresh.id },
        update: {},
      });
      const cursors = cursorMap(sync.commentCursors);
      if (options.reset) delete cursors[target.key];
      const comments = await listSocialPostComments(
        socialAccount(fresh),
        {
          nativePostId: target.nativePostId,
          nativeUrl: target.nativeUrl,
          platformData: target.platformData,
          publishedAt: target.publishedAt,
        },
        { cursor: cursors[target.key], limit: 50 },
      );
      if (!comments.ok) {
        errors.push({ accountId: fresh.id, message: comments.error.message });
        continue;
      }
      await saveItems(userId, fresh, "comment", target.postId, comments.data.data);
      if (comments.data.coverage)
        coverage.push({ accountId: fresh.id, platform: fresh.platform, message: comments.data.coverage });
      const nextCursor = safeProviderCursor(comments.data.nextCursor);
      if (comments.data.nextCursor && !nextCursor) {
        const message = `${fresh.platform} returned an invalid continuation cursor. Existing comments are retained; try a new sync.`;
        await prisma.socialActivitySync.update({
          where: { accountId: fresh.id },
          data: { commentCursors: cursors, lastCommentsSyncAt: new Date(), lastError: message },
        });
        errors.push({ accountId: fresh.id, message });
        continue;
      }
      if (nextCursor) cursors[target.key] = nextCursor;
      else delete cursors[target.key];
      await prisma.socialActivitySync.update({
        where: { accountId: fresh.id },
        data: { commentCursors: cursors, lastCommentsSyncAt: new Date(), lastError: null },
      });
    } catch {
      errors.push({
        accountId: target.account.id,
        message: `${target.account.platform} comments could not be refreshed. Cached comments are still shown.`,
      });
    }
  }
  return { ...(await getPostSocialActivity(userId, postId)), errors, coverage };
}

function metricView(
  metric: Awaited<ReturnType<typeof prisma.socialPostMetric.findMany>>[number] & { account: ConnectedAccount },
): SocialMetricView {
  return {
    id: metric.id,
    platform: metric.platform,
    accountId: metric.accountId,
    accountName: accountName(metric.account),
    nativePostId: metric.nativePostId,
    nativeUrl: safeNativeUrl(metric.nativeUrl ?? undefined),
    values: metric.values ? (object(metric.values) as Record<string, number>) : undefined,
    coverage: metric.coverage ?? undefined,
    fetchedAt: metric.fetchedAt?.toISOString(),
    lastAttemptAt: metric.lastAttemptAt.toISOString(),
    error: metric.errorMessage ?? undefined,
  };
}

function activityView(
  item: Awaited<ReturnType<typeof prisma.socialActivityItem.findMany>>[number] & {
    account: ConnectedAccount;
    replies: Array<{ status: string; body: string; nativeReplyUrl: string | null; errorMessage: string | null }>;
  },
): SocialActivityView {
  const reply = item.replies[0];
  return {
    id: item.id,
    kind: item.kind as SocialActivityKind,
    platform: item.platform,
    accountId: item.accountId,
    accountName: accountName(item.account),
    accountUsername: item.account.username ?? undefined,
    postId: item.postId ?? undefined,
    nativeUrl: safeNativeUrl(item.nativeUrl ?? undefined),
    nativePostId: item.nativePostId,
    body: item.body,
    createdAt: item.createdAtNative?.toISOString(),
    author: item.author ? (object(item.author) as SocialActivityView["author"]) : undefined,
    canReply: item.canReply,
    ...(reply
      ? {
          reply: {
            status: reply.status,
            body: reply.body,
            nativeReplyUrl: safeNativeUrl(reply.nativeReplyUrl ?? undefined),
            errorMessage: reply.errorMessage ?? undefined,
          },
        }
      : {}),
  };
}

export async function getSocialInbox(
  userId: string,
  options: { kind?: SocialActivityKind; platform?: string; accountId?: string; cursor?: string; limit?: number } = {},
) {
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const [cursorDate, cursorId] = options.cursor
    ? Buffer.from(options.cursor, "base64url").toString("utf8").split("|")
    : [];
  const cursor = cursorDate ? new Date(cursorDate) : undefined;
  if (options.cursor && (!cursor || !Number.isFinite(cursor.getTime()) || !cursorId))
    throw new BadRequestError("Invalid inbox cursor");
  const items = await prisma.socialActivityItem.findMany({
    where: {
      userId,
      ...(options.kind ? { kind: options.kind } : {}),
      ...(options.platform ? { platform: options.platform } : {}),
      ...(options.accountId ? { accountId: options.accountId } : {}),
      ...(cursor ? { OR: [{ firstSeenAt: { lt: cursor } }, { firstSeenAt: cursor, id: { lt: cursorId } }] } : {}),
    },
    include: { account: true, replies: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ firstSeenAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = items.slice(0, limit).map((item) => activityView(item));
  const last = items[limit - 1];
  return {
    items: page,
    nextCursor:
      items.length > limit && last
        ? Buffer.from(`${last.firstSeenAt.toISOString()}|${last.id}`).toString("base64url")
        : undefined,
  };
}

export async function refreshSocialInbox(userId: string, options: { includeMentions?: boolean; reset?: boolean } = {}) {
  const storedAccounts = await prisma.connectedAccount.findMany({ where: { userId } });
  const existingSyncs = await prisma.socialActivitySync.findMany({
    where: { accountId: { in: storedAccounts.map((account) => account.id) } },
  });
  const syncByAccount = new Map(existingSyncs.map((sync) => [sync.accountId, sync]));
  // The least recently visited account goes first. That provides a durable
  // round-robin without needing a global cursor row, and prevents a large
  // first account from starving accounts later in the account list.
  const accounts = storedAccounts
    .map((account) => decryptConnectedAccountSecrets(account))
    .sort((left, right) => {
      const leftSync = syncByAccount.get(left.id);
      const rightSync = syncByAccount.get(right.id);
      const leftAt = leftSync?.lastCommentsSyncAt ?? leftSync?.lastMentionsSyncAt ?? leftSync?.updatedAt ?? new Date(0);
      const rightAt =
        rightSync?.lastCommentsSyncAt ?? rightSync?.lastMentionsSyncAt ?? rightSync?.updatedAt ?? new Date(0);
      return leftAt.getTime() - rightAt.getTime() || left.id.localeCompare(right.id);
    })
    .slice(0, MAX_TARGETS_PER_REQUEST);
  const statuses: SocialRefreshStatus[] = [];
  let remaining = MAX_TARGETS_PER_REQUEST;
  const pages = new Map<string, Awaited<ReturnType<typeof ownedTargetPage>>>();
  const readPage = async (after?: string) => {
    const cacheKey = after ?? "first";
    const cached = pages.get(cacheKey);
    if (cached) return cached;
    const page = await ownedTargetPage(userId, after);
    pages.set(cacheKey, page);
    return page;
  };

  for (const account of accounts) {
    const sync = await prisma.socialActivitySync.upsert({
      where: { accountId: account.id },
      create: { accountId: account.id },
      update: {},
    });
    let stored = options.reset ? { targets: [], nextPostCursor: undefined } : targetSnapshot(sync.targetSnapshot);
    let index = options.reset ? 0 : sync.targetIndex;
    let cursors = options.reset ? {} : cursorMap(sync.commentCursors);
    // Start (or move to) a stable post page only when this account's existing
    // page is complete. A normal Continue never jumps back to newer posts.
    const currentPageComplete = index >= stored.targets.length && Object.keys(cursors).length === 0;
    if (options.reset || !sync.targetSnapshot || (currentPageComplete && Boolean(stored.nextPostCursor))) {
      const page = await readPage(options.reset ? undefined : stored.nextPostCursor);
      stored = serializeTargetSnapshot(
        page.targets.filter((target) => target.account.id === account.id),
        page.nextPostCursor,
      );
      index = 0;
      cursors = {};
    }
    const targets = stored.targets.map((target) => restoreTarget(account, target));
    let processed = 0;
    let failure: string | undefined;
    let invalidContinuation = false;
    const coverage: string[] = [];
    while (processed < MAX_TARGETS_PER_REFRESH && remaining > 0 && index < targets.length) {
      const target = targets[index];
      if (!getSocialActivityCapabilities(account.platform).has("comments")) {
        failure = `${account.platform} comments are unavailable for this connection.`;
        index += 1;
        continue;
      }
      let response: Awaited<ReturnType<typeof listSocialPostComments>>;
      let fresh: ConnectedAccount;
      remaining -= 1;
      try {
        fresh = await refreshedAccount(userId, account.id);
        response = await listSocialPostComments(
          socialAccount(fresh),
          {
            nativePostId: target.nativePostId,
            nativeUrl: target.nativeUrl,
            platformData: target.platformData,
            publishedAt: target.publishedAt,
          },
          { cursor: cursors[target.key], limit: 50 },
        );
      } catch {
        failure = `${account.platform} credentials could not be prepared. Try again.`;
        break;
      }
      if (!response.ok) {
        failure = response.error.message;
        break;
      }
      try {
        await saveItems(userId, fresh, "comment", target.postId, response.data.data);
      } catch {
        failure = "Comments could not be saved. Existing cached comments are still available.";
        break;
      }
      processed += 1;
      const nextCursor = safeProviderCursor(response.data.nextCursor);
      if (response.data.coverage) coverage.push(response.data.coverage);
      if (response.data.nextCursor && !nextCursor) {
        invalidContinuation = true;
        failure = `${account.platform} returned an invalid continuation cursor. Existing comments are retained; start a new sync to check newer activity.`;
        break;
      }
      if (nextCursor) cursors[target.key] = nextCursor;
      else {
        delete cursors[target.key];
        index += 1;
      }
    }
    const storedMentionCursor = options.reset ? undefined : (sync.mentionCursor ?? undefined);
    const mentionsComplete = storedMentionCursor === MENTION_COMPLETE_CURSOR;
    let mentionCursor = mentionsComplete ? undefined : safeProviderCursor(storedMentionCursor);
    let mentionsProcessed = false;
    let invalidMentionCursor = false;
    if (
      options.includeMentions &&
      !mentionsComplete &&
      remaining > 0 &&
      getSocialActivityCapabilities(account.platform).has("mentions")
    ) {
      remaining -= 1;
      try {
        const fresh = await refreshedAccount(userId, account.id);
        const mentions = await listSocialMentions(socialAccount(fresh), { cursor: mentionCursor, limit: 50 });
        if (mentions.ok) {
          await saveItems(userId, fresh, "mention", undefined, mentions.data.data);
          const previousMentionCursor = mentionCursor;
          const nextMentionCursor = safeProviderCursor(mentions.data.nextCursor);
          if (mentions.data.coverage) coverage.push(mentions.data.coverage);
          if (mentions.data.nextCursor && !nextMentionCursor) {
            invalidContinuation = true;
            invalidMentionCursor = true;
            mentionCursor = previousMentionCursor;
            failure ??= `${account.platform} returned an invalid mentions cursor. Existing activity is retained; start a new sync to check newer mentions.`;
          } else {
            mentionCursor = nextMentionCursor;
          }
          mentionsProcessed = true;
        } else failure ??= mentions.error.message;
      } catch {
        failure ??= `${account.platform} credentials could not be prepared. Try again.`;
      }
    }
    const hasMoreComments = index < targets.length || Object.keys(cursors).length > 0 || Boolean(stored.nextPostCursor);
    const hasMoreMentions =
      options.includeMentions &&
      getSocialActivityCapabilities(account.platform).has("mentions") &&
      !mentionsComplete &&
      (Boolean(mentionCursor) || !mentionsProcessed);
    await prisma.socialActivitySync.update({
      where: { accountId: account.id },
      data: {
        targetSnapshot: stored as unknown as Prisma.InputJsonValue,
        targetIndex: index,
        commentCursors: cursors,
        mentionCursor: mentionsComplete
          ? MENTION_COMPLETE_CURSOR
          : invalidMentionCursor
            ? (mentionCursor ?? null)
            : (mentionCursor ?? (mentionsProcessed ? MENTION_COMPLETE_CURSOR : null)),
        lastCommentsSyncAt: processed > 0 || targets.length > 0 ? new Date() : sync.lastCommentsSyncAt,
        lastMentionsSyncAt: mentionsProcessed ? new Date() : sync.lastMentionsSyncAt,
        lastError: failure ?? null,
      },
    });
    statuses.push({
      accountId: account.id,
      platform: account.platform,
      processed,
      mentionsProcessed,
      hasMore: hasMoreComments || hasMoreMentions || invalidContinuation,
      coverage: [
        ...coverage,
        hasMoreComments
          ? "More SimplePost post targets or comment pages remain."
          : hasMoreMentions
            ? "More account mention pages remain."
            : "Current snapshot complete.",
      ].join(" "),
      error: failure,
    });
  }
  const selectedAccountIds = new Set(accounts.map((account) => account.id));
  const hasDeferredWork = storedAccounts.some(
    (account) =>
      !selectedAccountIds.has(account.id) &&
      hasPendingAccountSync(syncByAccount.get(account.id), account.platform, options.includeMentions),
  );
  return { accounts: statuses, hasMore: statuses.some((status) => status.hasMore) || hasDeferredWork };
}

export async function sendSocialReply(userId: string, input: { itemId: string; body: string; idempotencyKey: string }) {
  const body = input.body.trim();
  if (!body) throw new BadRequestError("Write a reply before sending it.");
  if (body.length > MAX_REPLY_LENGTH) throw new BadRequestError("Replies cannot exceed 5,000 characters.");
  if (!/^[a-zA-Z0-9_-]{12,160}$/.test(input.idempotencyKey)) throw new BadRequestError("Invalid reply key");
  const item = await prisma.socialActivityItem.findFirst({
    where: { id: input.itemId, userId },
    include: { account: true },
  });
  if (!item) throw new NotFoundError("Social activity item not found");
  if (!item.canReply) throw new BadRequestError("This platform does not allow replies through the connected account.");
  // Prepare credentials before recording a provider-bound intent. A refresh
  // failure is therefore a safe local failure instead of a stale pending row.
  const account = await refreshedAccount(userId, item.accountId);
  let reply = await prisma.socialActivityReply.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
  });
  if (reply && (reply.activityItemId !== item.id || reply.body !== body))
    throw new ConflictError("This reply key belongs to a different reply.");
  if (reply?.status === "sent")
    return {
      replyId: reply.id,
      status: reply.status,
      nativeReplyUrl: safeNativeUrl(reply.nativeReplyUrl ?? undefined),
    };
  if (reply?.status === "pending" || reply?.status === "uncertain")
    throw new ConflictError("This reply is already being sent. Check the platform before trying another reply.");
  if (reply?.status === "failed") {
    const claimed = await prisma.socialActivityReply.updateMany({
      where: { id: reply.id, status: "failed" },
      data: { status: "pending", errorCode: null, errorMessage: null },
    });
    if (claimed.count !== 1) throw new ConflictError("This reply changed while it was being retried.");
    reply = { ...reply, status: "pending" };
  }
  if (!reply) {
    try {
      reply = await prisma.socialActivityReply.create({
        data: {
          userId,
          accountId: item.accountId,
          activityItemId: item.id,
          idempotencyKey: input.idempotencyKey,
          body,
        },
      });
    } catch {
      throw new ConflictError("This reply changed while it was being created.");
    }
  }
  const response = await replyToSocialComment({
    account: socialAccount(account),
    target: {
      nativeId: item.nativeId,
      nativePostId: item.nativePostId,
      nativeUrl: item.nativeUrl ?? undefined,
      body: item.body,
      createdAt: item.createdAtNative?.toISOString(),
      author: item.author ? (object(item.author) as SocialComment["author"]) : undefined,
      canReply: item.canReply,
      replyTarget: item.providerData ? object(item.providerData) : undefined,
    },
    text: body,
  });
  if (!response.ok) {
    // A malformed response following a POST can mean the provider accepted it;
    // leave the intent uncertain and never replay it automatically.
    const terminal = [
      "permission_required",
      "authentication",
      "not_found",
      "unsupported",
      "rate_limited",
      "invalid_request",
    ].includes(response.error.code);
    await prisma.socialActivityReply.update({
      where: { id: reply.id },
      data: {
        status: terminal ? "failed" : "uncertain",
        errorCode: response.error.code,
        errorMessage: response.error.message,
      },
    });
    throw new BadRequestError(response.error.message);
  }
  await prisma.socialActivityReply.update({
    where: { id: reply.id },
    data: {
      status: "sent",
      nativeReplyId: response.data.nativeId,
      nativeReplyUrl: response.data.nativeUrl,
      errorCode: null,
      errorMessage: null,
    },
  });
  return { replyId: reply.id, status: "sent", nativeReplyUrl: response.data.nativeUrl };
}
