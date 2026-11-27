import { randomUUID } from "node:crypto";

import { Feature, Prisma } from "@prisma/client";
import {
  getSocialActivityCapabilities,
  likeSocialItem,
  listSocialPostComments,
  listSocialPostQuotes,
  PlatformSchema,
  replyToSocialComment,
} from "@simple-post/sdk";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import { requireSocialInbox, usersWithFeature } from "@/lib/features";
import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/utils/errors";
import type { AccountPublishResult, ConnectedAccount, MediaFile } from "@/types";

import { enabledInboxScopes, hasInboxScopes } from "./permissions";

import type { SocialActivityAccount, SocialActivityError, SocialComment } from "@simple-post/sdk";

const MAX_REQUESTS = 8;
const RECENT_SYNC_INTERVAL_MS = 2 * 60_000;
const X_SYNC_INTERVAL_MS = 5 * 60_000;
const SYNC_BUDGET_MS = 20_000;
const MAX_ACCOUNTS = 12;
const MAX_BACKGROUND_READS = 24;
const MAX_BACKGROUND_ACCOUNTS = 24;
const MAX_BACKGROUND_READS_PER_ACCOUNT = 6;
const DEFAULT_X_BACKGROUND_INTERVAL_MINUTES = 360;
const X_RECENT_PAGE_SIZE = 10;
const POSTS_PER_SNAPSHOT = 25;
const RECENT_POSTS_PER_SNAPSHOT = 5;
const MAX_CURSOR_LENGTH = 2048;
const LEASE_MS = 8 * 60 * 1000;
const ACTION_TIMEOUT_MS = 90_000;

class InboxReconnectRequiredError extends BadRequestError {}

export type SocialActivityKind = "comment" | "reply" | "quote";

export interface SocialInboxQuery {
  workspaceId?: string | null;
  kind?: SocialActivityKind;
  platform?: string;
  platforms?: string[];
  accountId?: string;
  needsReply?: boolean;
  cursor?: string;
  limit?: number;
}

type InboxReadPhase = "comments" | "quotes";

interface OwnedTarget {
  key: string;
  postId: string;
  accountId: string;
  nativePostId: string;
  nativeUrl?: string;
  platformData?: Record<string, unknown>;
  publishedAt?: string;
  readPhase?: InboxReadPhase;
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
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
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
    accountId: account.id,
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
  prioritizeRootReplies: boolean,
): OwnedTarget[] {
  const targets: OwnedTarget[] = [];
  const segments: OwnedTarget[] = [];
  const seen = new Set<string>();
  for (const post of posts) {
    const results = object(post.accountResults) as Record<string, AccountPublishResult>;
    const accounts = new Map(post.accounts.map((account) => [account.id, account]));
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
          (prioritizeRootReplies ? segments : targets).push(segmentTarget);
          seen.add(segmentTarget.key);
        }
      }
    }
  }
  if (!prioritizeRootReplies) return targets;

  // A Bluesky root read already includes replies in its thread. Give all
  // recent roots a turn before quote lookups and the separate segment reads.
  return [
    ...targets.map((target): OwnedTarget => ({ ...target, readPhase: "comments" })),
    ...targets.map((target): OwnedTarget => ({ ...target, readPhase: "quotes" })),
    ...segments,
  ];
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
async function ownedTargetPage(
  userId: string,
  accountId: string,
  workspaceId: string | null,
  after: string | undefined,
  recent: boolean,
  prioritizeRootReplies: boolean,
) {
  const limit = recent ? RECENT_POSTS_PER_SNAPSHOT : POSTS_PER_SNAPSHOT;
  const cursor = decodePostCursor(after);
  const posts = await prisma.post.findMany({
    where: {
      userId,
      accounts: { some: { id: accountId, userId, workspaceId } },
      status: { in: ["published", "failed"] },
      accountResults: { path: [accountId, "success"], equals: true },
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
        : {}),
    },
    include: { accounts: { where: { id: accountId, userId, workspaceId } } },
    orderBy: recent
      ? [{ publishedAt: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }, { id: "desc" }]
      : [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = posts.slice(0, limit);
  const last = page.at(-1);
  return {
    targets: targetsFromPosts(page, prioritizeRootReplies),
    nextPostCursor: posts.length > limit && last ? encodePostCursor(last) : undefined,
  };
}

async function refreshedAccount(
  userId: string,
  accountId: string,
  workspaceId: string | null,
  reason: "manual" | "background" = "manual",
): Promise<ConnectedAccount> {
  const stored = await prisma.connectedAccount.findFirst({ where: { id: accountId, userId, workspaceId } });
  if (!stored) throw new NotFoundError("Connected account not found");
  const decrypted = decryptConnectedAccountSecrets(stored);
  const result = await withAccountLock(accountId, async () => {
    const latest = await reloadAccountSecrets(decrypted);
    return refreshConnectedAccountIfNeeded(latest, { reason });
  });
  if (result.error && result.status.state === "reauth_required") throw new InboxReconnectRequiredError(result.error);
  if (result.error) throw new BadRequestError(result.error);
  return result.account;
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

interface TargetSnapshot {
  targets: Array<
    Pick<OwnedTarget, "key" | "postId" | "nativePostId" | "nativeUrl" | "platformData" | "publishedAt" | "readPhase">
  >;
  nextPostCursor?: string;
  rootRepliesFirst?: true;
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
        readPhase: target.readPhase === "comments" || target.readPhase === "quotes" ? target.readPhase : undefined,
      } satisfies TargetSnapshot["targets"][number],
    ];
  });
  return {
    targets,
    ...(stored.rootRepliesFirst === true && { rootRepliesFirst: true }),
    nextPostCursor:
      typeof stored.nextPostCursor === "string" && decodePostCursor(stored.nextPostCursor)
        ? stored.nextPostCursor
        : undefined,
  };
}

function serializeTargetSnapshot(
  targets: OwnedTarget[],
  nextPostCursor: string | undefined,
  prioritizeRootReplies: boolean,
): TargetSnapshot {
  return {
    targets: targets.map(({ key, postId, nativePostId, nativeUrl, platformData, publishedAt, readPhase }) => ({
      key,
      postId,
      nativePostId,
      nativeUrl: safeNativeUrl(nativeUrl),
      platformData: boundedJson(platformData),
      publishedAt,
      readPhase,
    })),
    nextPostCursor,
    ...(prioritizeRootReplies && { rootRepliesFirst: true }),
  };
}

function isSelf(account: ConnectedAccount, target: OwnedTarget, item: SocialComment): boolean {
  const id = item.author?.id?.replace(/^urn:li:(person|organization):/, "");
  const ownId = account.platformAccountId.replace(/^urn:li:(person|organization):/, "");
  return (
    item.nativeId === target.nativePostId ||
    id === ownId ||
    (!!account.username &&
      item.author?.username?.toLowerCase().replace(/^@/, "") === account.username.toLowerCase().replace(/^@/, ""))
  );
}

async function saveItems(
  tx: Prisma.TransactionClient,
  userId: string,
  account: ConnectedAccount,
  target: OwnedTarget,
  phase: InboxReadPhase,
  items: SocialComment[],
): Promise<void> {
  if (
    !(await tx.post.findFirst({
      where: { id: target.postId, userId, accounts: { some: { id: account.id } } },
      select: { id: true },
    }))
  )
    return;
  for (const item of items) {
    if (!isUsableNativeId(item.nativeId) || isSelf(account, target, item)) continue;
    const kind = phase === "quotes" ? "quote" : (item.kind ?? "comment");
    const liked = item.liked === true;
    const data = {
      nativeUrl: safeNativeUrl(item.nativeUrl),
      body: item.body.slice(0, 10_000),
      author: boundedJson(item.author) as Prisma.InputJsonValue | undefined,
      providerData: boundedJson(item.replyTarget) as Prisma.InputJsonValue | undefined,
      canReply: item.canReply,
      canLike: item.canLike ?? false,
      lastSeenAt: new Date(),
      ...(liked ? { liked: true, likeStatus: "sent", likeError: null } : {}),
    };
    await tx.socialActivityItem.upsert({
      where: { accountId_nativeId: { accountId: account.id, nativeId: item.nativeId } },
      create: {
        ...data,
        userId,
        accountId: account.id,
        postId: target.postId,
        platform: mapPlatformName(account.platform),
        kind,
        nativeId: item.nativeId,
        nativePostId: target.nativePostId,
        sourceUrl: safeNativeUrl(target.nativeUrl),
        createdAtNative: date(item.createdAt),
        eventAt: date(item.createdAt) ?? new Date(),
      },
      update: { ...data, ...(kind === "quote" ? { kind } : {}) },
    });
  }
  // Conversation reads include replies written directly on X. Match only a
  // reply by the connected identity to its explicit parent in this inbox.
  if (mapPlatformName(account.platform) !== "x") return;
  for (const item of items) {
    if (
      !isUsableNativeId(item.nativeId) ||
      !isUsableNativeId(item.parentNativeId) ||
      !isSelf(account, target, item) ||
      item.nativeId === target.nativePostId
    )
      continue;
    const parent = await tx.socialActivityItem.findFirst({
      where: { accountId: account.id, nativeId: item.parentNativeId, userId },
      select: { id: true },
    });
    if (!parent) continue;
    const recorded = await tx.socialActivityReply.findFirst({
      where: { activityItemId: parent.id, nativeReplyId: item.nativeId },
      select: { id: true },
    });
    if (!recorded) {
      const idempotencyKey = `native:x:${account.id}:${item.nativeId}`;
      await tx.socialActivityReply.upsert({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
        update: {},
        create: {
          userId,
          accountId: account.id,
          activityItemId: parent.id,
          idempotencyKey,
          status: "sent",
          body: item.body.slice(0, 5000),
          createdAt: date(item.createdAt) ?? undefined,
          nativeReplyId: item.nativeId,
          nativeReplyUrl: safeNativeUrl(item.nativeUrl),
        },
      });
    }
  }
}

async function syncXLikes(
  account: ConnectedAccount,
  leaseToken: string,
  maxPages: number,
  signal: AbortSignal,
  pageSize = 100,
) {
  if (
    mapPlatformName(account.platform) !== "x" ||
    !/^\d+$/.test(account.platformAccountId) ||
    !hasInboxScopes(account.scope, ["like.read"])
  )
    return false;

  const startedAt = new Date();
  const url = new URL(`https://api.x.com/2/users/${account.platformAccountId}/liked_tweets?max_results=${pageSize}`);
  const ids = new Set<string>();
  let hadValidPage = false;
  let complete = false;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetch(new URL(url), {
      headers: { Authorization: `Bearer ${account.accessToken}` },
      redirect: "error",
      signal,
    }).catch(() => null);
    if (!response?.ok) break;
    const payload = object(await response.json().catch(() => null));
    const meta = object(payload.meta);
    const likes = Array.isArray(payload.data) ? payload.data : [];
    if (typeof meta.result_count !== "number" || likes.length !== meta.result_count || Array.isArray(payload.errors))
      break;
    const pageIds = likes.map((like: unknown) => object(like).id).filter((id) => isUsableNativeId(id));
    if (pageIds.length !== likes.length) break;
    hadValidPage = true;
    for (const id of pageIds) ids.add(id);
    if (meta.next_token == null) {
      complete = true;
      break;
    }
    const next = typeof meta.next_token === "string" ? safeProviderCursor(meta.next_token) : undefined;
    if (!next || next === url.searchParams.get("pagination_token")) break;
    url.searchParams.set("pagination_token", next);
  }
  if (!hadValidPage) return false;
  const where = {
    accountId: account.id,
    OR: [
      { likeAttemptAt: null },
      { likeAttemptAt: { lt: startedAt }, OR: [{ likeStatus: null }, { likeStatus: { not: "pending" } }] },
    ],
  };
  return prisma.$transaction(async (tx) => {
    const lease = await tx.socialActivitySync.updateMany({
      where: { accountId: account.id, leaseToken },
      data: { leaseToken },
    });
    if (!lease.count) return false;
    await tx.socialActivityItem.updateMany({
      where: { ...where, nativeId: { in: [...ids] } },
      data: { liked: true, likeStatus: "sent", likeError: null },
    });
    // A truncated list only establishes positive matches. Give a recent
    // local write time to become visible in a complete provider response.
    if (complete) {
      await tx.socialActivityItem.updateMany({
        where: {
          ...where,
          liked: true,
          nativeId: { notIn: [...ids] },
          AND: [
            {
              OR: [
                { likeAttemptAt: null },
                { likeAttemptAt: { lt: new Date(startedAt.getTime() - ACTION_TIMEOUT_MS) } },
              ],
            },
          ],
        },
        data: { liked: false, likeStatus: null, likeError: null },
      });
    }
    return true;
  });
}

const feedAccountSelect = {
  id: true,
  platform: true,
  displayName: true,
  username: true,
  scope: true,
  platformAccountId: true,
  profilePicture: true,
  socialActivitySync: {
    select: {
      lastSyncedAt: true,
      lastAttemptAt: true,
      lastError: true,
      lastErrorCode: true,
      coverage: true,
      retryAt: true,
      targetIndex: true,
      targetSnapshot: true,
      providerCursor: true,
    },
  },
} satisfies Prisma.ConnectedAccountSelect;

function accountLabel(account: { displayName: string | null; username: string | null }) {
  return account.displayName || account.username || "Connected account";
}

export async function getSocialInbox(userId: string, options: SocialInboxQuery = {}) {
  await requireSocialInbox(userId);
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const cursor = decodePostCursor(options.cursor);
  if (options.cursor && !cursor) throw new BadRequestError("Invalid inbox cursor");
  const [items, accounts] = await Promise.all([
    prisma.socialActivityItem.findMany({
      where: {
        userId,
        account: { workspaceId: options.workspaceId ?? null },
        kind: options.kind,
        platform: options.platforms?.length ? { in: options.platforms } : options.platform,
        accountId: options.accountId,
        ...(options.needsReply ? { canReply: true, replies: { none: { status: "sent" } } } : {}),
        ...(cursor
          ? { OR: [{ eventAt: { lt: cursor.createdAt } }, { eventAt: cursor.createdAt, id: { lt: cursor.id } }] }
          : {}),
      },
      include: {
        account: { select: feedAccountSelect },
        post: {
          select: {
            message: true,
            accountOverrides: true,
            media: {
              select: { id: true, type: true, url: true, thumbnailUrl: true, filename: true, size: true },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
            publishedAt: true,
          },
        },
        replies: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5 },
      },
      orderBy: [{ eventAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    }),
    prisma.connectedAccount.findMany({
      where: { userId, workspaceId: options.workspaceId ?? null },
      select: feedAccountSelect,
      orderBy: { id: "asc" },
    }),
  ]);
  const last = items[limit - 1];
  return {
    items: items.slice(0, limit).map((item) => {
      const reply = item.replies.find((entry) => entry.status === "sent") ?? item.replies[0];
      const override = object(object(item.post.accountOverrides)[item.accountId]);
      const postedMessage = override.enabled === false ? undefined : override.message;
      const media = override.enabled !== false && Array.isArray(override.media) ? override.media : item.post.media;
      const sourcePreview = {
        media: media.flatMap((value: unknown) => {
          const { id, type, url, thumbnailUrl, filename, size } = object(value);
          if (typeof id !== "string" || (type !== "image" && type !== "video") || typeof url !== "string") return [];
          return [
            {
              id,
              type,
              url,
              thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl : undefined,
              filename: typeof filename === "string" ? filename : "",
              size: typeof size === "number" ? size : 0,
            } satisfies MediaFile,
          ];
        }),
        profilePicture: item.account.profilePicture,
        publishedAt: item.post.publishedAt?.toISOString(),
      };
      return {
        id: item.id,
        kind: item.kind as SocialActivityKind,
        platform: item.platform,
        accountId: item.accountId,
        accountName: accountLabel(item.account),
        accountUsername: item.account.username ?? undefined,
        postId: item.postId,
        sourceBody: typeof postedMessage === "string" ? postedMessage : item.post.message,
        sourcePreview,
        sourceUrl: safeNativeUrl(item.sourceUrl ?? undefined),
        nativeUrl: safeNativeUrl(item.nativeUrl ?? undefined),
        body: item.body,
        createdAt: item.createdAtNative?.toISOString() ?? item.eventAt.toISOString(),
        author: item.author ? (object(item.author) as SocialComment["author"]) : undefined,
        canReply: item.canReply,
        canLike: item.canLike && (item.platform !== "x" || hasInboxScopes(item.account.scope, ["like.write"])),
        liked: item.liked,
        likeStatus: item.likeStatus ?? undefined,
        likeError: item.likeError ?? undefined,
        reply: reply
          ? {
              status: replyStatus(reply),
              body: reply.body,
              nativeReplyUrl: safeNativeUrl(reply.nativeReplyUrl ?? undefined),
              errorMessage: reply.errorMessage ?? undefined,
            }
          : undefined,
      };
    }),
    accounts: accounts
      .filter((account) => supportsInbox(account.platform))
      .map((account) => ({
        id: account.id,
        platform: mapPlatformName(account.platform),
        name: accountLabel(account),
        canSync: supportsInbox(account.platform),
        hasMore:
          account.socialActivitySync?.lastErrorCode !== "no_tracked_posts" &&
          hasMoreInboxWork(account.socialActivitySync),
        needsLikePermission:
          mapPlatformName(account.platform) === "x" &&
          enabledInboxScopes("x").includes("like.read") &&
          !hasInboxScopes(account.scope, ["like.read"]),
        noTrackedPosts: account.socialActivitySync?.lastErrorCode === "no_tracked_posts",
        lastCheckedAt: account.socialActivitySync?.lastAttemptAt?.toISOString(),
        permissionUrl:
          account.socialActivitySync?.lastErrorCode !== "app_permission_required" &&
          (account.socialActivitySync?.lastErrorCode === "authentication" ||
            !hasInboxScopes(
              account.scope,
              enabledInboxScopes(mapPlatformName(account.platform)).filter((scope) => scope !== "like.read"),
            ))
            ? `/api/connect/${account.platform}?inboxAccountId=${encodeURIComponent(account.id)}`
            : undefined,
        lastSyncedAt: account.socialActivitySync?.lastSyncedAt?.toISOString(),
        error: account.socialActivitySync?.lastError ?? undefined,
        coverage: account.socialActivitySync?.coverage ?? undefined,
        retryAt: account.socialActivitySync?.retryAt?.toISOString(),
      })),
    nextCursor: items.length > limit && last ? encodePostCursor({ createdAt: last.eventAt, id: last.id }) : undefined,
  };
}

export type SocialInbox = Awaited<ReturnType<typeof getSocialInbox>>;
export type SocialInboxItem = SocialInbox["items"][number];

function hasMoreInboxWork(
  sync: { targetIndex: number; targetSnapshot: unknown; providerCursor: string | null } | null,
) {
  if (!sync?.targetSnapshot || !Array.isArray(object(sync.targetSnapshot).targets)) return Boolean(sync);
  const snapshot = targetSnapshot(sync.targetSnapshot);
  return Boolean(sync.providerCursor || sync.targetIndex < snapshot.targets.length || snapshot.nextPostCursor);
}

function supportsInbox(platform: string) {
  const capabilities = getSocialActivityCapabilities(platform);
  return capabilities.has("comments") || capabilities.has("quotes");
}

function retryAt(error: SocialActivityError) {
  if (error.code === "app_permission_required") return new Date(Date.now() + 30 * 60_000);
  if (error.code !== "rate_limited" && error.code !== "transient") return null;
  return new Date(Date.now() + Math.min(error.retryAfterSeconds ?? 60, 86_400) * 1000);
}

const syncAccountSelect = {
  id: true,
  userId: true,
  workspaceId: true,
  platform: true,
  scope: true,
  socialActivitySync: { select: { lastAttemptAt: true } },
} satisfies Prisma.ConnectedAccountSelect;

type SyncAccount = Prisma.ConnectedAccountGetPayload<{ select: typeof syncAccountSelect }>;

function dueBefore(platform: string, now: Date, xIntervalMs = X_SYNC_INTERVAL_MS) {
  return new Date(now.getTime() - (mapPlatformName(platform) === "x" ? xIntervalMs : RECENT_SYNC_INTERVAL_MS));
}

function syncAvailable(now: Date, before?: Date): Prisma.SocialActivitySyncWhereInput {
  return {
    AND: [
      { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
      { OR: [{ retryAt: null }, { retryAt: { lte: now } }] },
      ...(before ? [{ OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: before } }] }] : []),
    ],
  };
}

function backgroundXIntervalMinutes() {
  const value = Number(
    process.env.SOCIAL_INBOX_BACKGROUND_X_INTERVAL_MINUTES?.trim() || DEFAULT_X_BACKGROUND_INTERVAL_MINUTES,
  );
  if (!Number.isSafeInteger(value) || value < 0 || value > 1440) return DEFAULT_X_BACKGROUND_INTERVAL_MINUTES;
  return value === 0 ? 0 : Math.max(60, value);
}

export async function runBackgroundInboxRefresh() {
  if (process.env.SOCIAL_INBOX_BACKGROUND_REFRESH?.toLowerCase() === "false") return;
  const now = new Date();
  const xIntervalMinutes = backgroundXIntervalMinutes();
  const xIntervalMs = xIntervalMinutes * 60_000;
  const platforms = PlatformSchema.options.filter((platform) => platform !== "x" && supportsInbox(platform));
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      user: usersWithFeature(Feature.SOCIAL_INBOX),
      credentialRefreshBlockedAt: null,
      posts: { some: { status: { in: ["published", "failed"] } } },
      AND: [
        {
          OR: [{ workspaceId: null }, { user: usersWithFeature(Feature.TEAM_WORKSPACES) }],
        },
        {
          OR: [
            {
              platform: { in: platforms },
              OR: [
                { socialActivitySync: null },
                { socialActivitySync: { is: syncAvailable(now, new Date(now.getTime() - RECENT_SYNC_INTERVAL_MS)) } },
              ],
            },
            ...(xIntervalMinutes === 0
              ? []
              : [
                  {
                    platform: { in: ["x", "twitter"] },
                    OR: [
                      { socialActivitySync: null },
                      { socialActivitySync: { is: syncAvailable(now, dueBefore("x", now, xIntervalMs)) } },
                    ],
                  },
                ]),
          ],
        },
      ],
    },
    orderBy: [{ socialActivitySync: { lastAttemptAt: { sort: "asc", nulls: "first" } } }, { id: "asc" }],
    select: {
      ...syncAccountSelect,
      workspace: { select: { creatorId: true, members: { where: { role: "Admin" }, select: { userId: true } } } },
    },
    take: MAX_BACKGROUND_ACCOUNTS,
  });
  const eligible = accounts.filter(
    ({ userId, workspace }) =>
      !workspace || (workspace.creatorId === userId && workspace.members.some((member) => member.userId === userId)),
  );
  return refreshInboxAccounts(eligible, { automatic: true, background: true, xIntervalMs });
}

export async function refreshSocialInbox(
  userId: string,
  options: {
    reset?: boolean;
    platform?: string;
    platforms?: string[];
    automatic?: boolean;
    workspaceId?: string | null;
  } = {},
) {
  await requireSocialInbox(userId);
  const now = new Date();
  const workspaceId = options.workspaceId ?? null;
  const platforms = options.platforms?.length ? options.platforms : options.platform ? [options.platform] : [];
  const connected = await prisma.connectedAccount.findMany({
    where: {
      userId,
      workspaceId,
      platform:
        platforms.length > 0
          ? { in: platforms.flatMap((platform) => (platform === "x" ? ["x", "twitter"] : [platform])) }
          : undefined,
    },
    select: syncAccountSelect,
  });
  const accounts = connected
    .filter((account) => supportsInbox(account.platform))
    .filter(
      (account) =>
        !options.automatic ||
        !account.socialActivitySync?.lastAttemptAt ||
        account.socialActivitySync.lastAttemptAt <= dueBefore(account.platform, now),
    )
    .sort(
      (a, b) =>
        (a.socialActivitySync?.lastAttemptAt?.getTime() ?? 0) - (b.socialActivitySync?.lastAttemptAt?.getTime() ?? 0) ||
        a.id.localeCompare(b.id),
    );
  const result = await refreshInboxAccounts(accounts.slice(0, MAX_ACCOUNTS), {
    automatic: options.automatic,
    reset: options.reset,
    focusedPlatform: platforms.length === 1,
  });
  return { ...result, hasMore: result.hasMore || accounts.length > MAX_ACCOUNTS };
}

async function refreshInboxAccounts(
  accounts: SyncAccount[],
  options: {
    automatic?: boolean;
    reset?: boolean;
    background?: boolean;
    xIntervalMs?: number;
    focusedPlatform?: boolean;
  },
) {
  let remaining = options.background ? MAX_BACKGROUND_READS : MAX_REQUESTS;
  const deadline = Date.now() + SYNC_BUDGET_MS;
  const statuses: { accountId: string; platform: string; processed: number; hasMore: boolean; error?: string }[] = [];
  for (const account of accounts) {
    if (remaining <= 0 || Date.now() >= deadline) break;
    const { id: accountId, userId, workspaceId } = account;
    const token = randomUUID();
    const now = new Date();
    if (!account.socialActivitySync) {
      try {
        await prisma.socialActivitySync.createMany({ data: { accountId }, skipDuplicates: true });
      } catch (error) {
        // The connection can be deleted between selection and the first sync.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") continue;
        throw error;
      }
    }
    const before = options.automatic ? dueBefore(account.platform, now, options.xIntervalMs) : undefined;
    const claim = await prisma.socialActivitySync.updateMany({
      where: { accountId, account: { userId, workspaceId }, ...syncAvailable(now, before) },
      data: { leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now },
    });
    if (!claim.count) continue;
    const sync = await prisma.socialActivitySync.findUnique({ where: { accountId } });
    if (!sync) continue;
    const persistedSnapshot = object(sync.targetSnapshot);
    const recent = object(persistedSnapshot.recent);
    const snapshot = options.automatic ? recent.snapshot : sync.targetSnapshot;
    const hasSnapshot = Array.isArray(object(snapshot).targets);
    let stored = targetSnapshot(snapshot);
    let index = options.automatic ? Number(recent.index ?? 0) : sync.targetIndex;
    let cursor = options.automatic
      ? safeProviderCursor(typeof recent.cursor === "string" ? recent.cursor : undefined)
      : (sync.providerCursor ?? undefined);
    let phase: InboxReadPhase = (options.automatic ? recent.phase : sync.phase) === "quotes" ? "quotes" : "comments";
    let processed = 0;
    let attempted = 0;
    let failure: string | undefined;

    // Keep recent polling independent of the manual older-post scan. A
    // recent pass resumes across ticks and starts over only after it finishes.
    function syncProgress(): Prisma.SocialActivitySyncUpdateManyMutationInput {
      if (options.automatic) {
        return {
          targetSnapshot: {
            ...persistedSnapshot,
            recent: { snapshot: stored, index, cursor: cursor ?? null, phase },
          } as unknown as Prisma.InputJsonValue,
        };
      }
      return {
        targetSnapshot: { ...stored, recent } as unknown as Prisma.InputJsonValue,
        targetIndex: index,
        providerCursor: cursor ?? null,
        phase,
      };
    }

    try {
      const prioritizeRootReplies = mapPlatformName(account.platform) === "bluesky";
      // Replace older automatic Bluesky plans once so requests already in the
      // queue do not keep the old order until a whole pass completes.
      const startRecent =
        options.reset ||
        (options.automatic && (index >= stored.targets.length || (prioritizeRootReplies && !stored.rootRepliesFirst)));
      if (startRecent || !hasSnapshot || index >= stored.targets.length) {
        const after = startRecent ? undefined : stored.nextPostCursor;
        if (startRecent || !hasSnapshot || after) {
          const page = await ownedTargetPage(
            userId,
            accountId,
            workspaceId,
            after,
            options.automatic === true,
            prioritizeRootReplies,
          );
          stored = serializeTargetSnapshot(
            page.targets,
            options.automatic ? undefined : page.nextPostCursor,
            prioritizeRootReplies,
          );
          index = 0;
          cursor = undefined;
          phase = "comments";
        }
      }
      const capabilities = getSocialActivityCapabilities(account.platform);
      const hasTargets = index < stored.targets.length;
      const isX = mapPlatformName(account.platform) === "x";
      const canReadLikes = isX && hasInboxScopes(account.scope, ["like.read"]);
      const syncLikes =
        canReadLikes &&
        (hasTargets ||
          Boolean(
            await prisma.socialActivityItem.findFirst({
              where: { accountId, userId, canLike: true },
              select: { id: true },
            }),
          ));
      if (options.background) await requireSocialInbox(userId);
      const fresh =
        hasTargets || syncLikes
          ? await refreshedAccount(userId, accountId, workspaceId, options.background ? "background" : "manual")
          : undefined;
      // Keep one account from monopolizing the sweep, and cap billed reads on X.
      const accountReadLimit = options.background ? (isX ? 1 : MAX_BACKGROUND_READS_PER_ACCOUNT) : 3;
      // Browser and worker resume the same recent cursor with the same page size.
      const pageSize = options.automatic && isX ? X_RECENT_PAGE_SIZE : 50;
      while (
        fresh &&
        index < stored.targets.length &&
        remaining > Number(syncLikes) &&
        attempted < accountReadLimit &&
        Date.now() < deadline
      ) {
        await requireSocialInbox(userId);
        remaining -= 1;
        attempted += 1;
        const target = { ...stored.targets[index], accountId };
        if (target.readPhase) phase = target.readPhase;
        else if (phase === "comments" && !capabilities.has("comments")) phase = "quotes";
        const list = phase === "quotes" ? listSocialPostQuotes : listSocialPostComments;
        const itemPhase = phase;
        const response = await list(socialAccount(fresh), target, { cursor, limit: pageSize });
        const skippable =
          !response.ok &&
          ["not_found", "unsupported", "invalid_request", "permission_required"].includes(response.error.code);
        failure = !response.ok && !skippable ? response.error.message : undefined;
        const next = response.ok ? safeProviderCursor(response.data.nextCursor) : undefined;
        if (next && next !== cursor) cursor = next;
        else if (response.ok || skippable) {
          cursor = undefined;
          if (!target.readPhase && phase === "comments" && capabilities.has("quotes")) phase = "quotes";
          else {
            index += 1;
            phase = "comments";
          }
        }
        if (response.ok) processed += 1;
        const saved = await prisma.$transaction(
          async (tx) => {
            const saved = await tx.socialActivitySync.updateMany({
              where: { accountId, leaseToken: token },
              data: {
                ...syncProgress(),
                lastSyncedAt: response.ok ? new Date() : undefined,
                lastError: failure ?? null,
                lastErrorCode: response.ok || skippable ? null : response.error.code,
                coverage: response.ok ? (response.data.coverage ?? undefined) : undefined,
                retryAt: response.ok ? null : retryAt(response.error),
              },
            });
            if (saved.count && response.ok) await saveItems(tx, userId, fresh, target, itemPhase, response.data.data);
            return saved.count > 0;
          },
          { timeout: 15_000 },
        );
        if (!saved || (!response.ok && !skippable)) break;
      }
      if (
        fresh &&
        remaining > 0 &&
        Date.now() < deadline &&
        syncLikes &&
        (!options.background || !failure) &&
        hasInboxScopes(fresh.scope, ["like.read"])
      ) {
        // A manual refresh focused on X can look further back without taking
        // requests away from other platforms during routine polling.
        const pages = !options.automatic && options.focusedPlatform ? Math.min(2, remaining) : 1;
        remaining -= pages;
        const synced = await syncXLikes(
          fresh,
          token,
          pages,
          AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now()))),
          options.background ? X_RECENT_PAGE_SIZE : undefined,
        ).catch(() => false);
        if (!synced && !failure) {
          failure = "X could not sync likes. Replies and quotes are still available.";
          await prisma.socialActivitySync.updateMany({
            where: { accountId, leaseToken: token },
            data: { lastError: failure, lastErrorCode: "likes_unavailable" },
          });
        } else if (synced && !failure) {
          await prisma.socialActivitySync.updateMany({
            where: { accountId, leaseToken: token, lastErrorCode: "likes_unavailable" },
            data: { lastError: null, lastErrorCode: null },
          });
        }
      }
      if (!hasTargets && (options.automatic || options.reset || !hasSnapshot)) {
        await prisma.socialActivitySync.updateMany({
          where: { accountId, leaseToken: token },
          data: {
            ...syncProgress(),
            lastError: failure ?? null,
            lastErrorCode: failure ? "likes_unavailable" : "no_tracked_posts",
          },
        });
      }
    } catch (error) {
      const needsReconnect = error instanceof InboxReconnectRequiredError;
      failure = needsReconnect
        ? error.message
        : "Could not finish refreshing this account. Previously synced items are still available.";
      await prisma.socialActivitySync.updateMany({
        where: { accountId, leaseToken: token },
        data: { lastError: failure, lastErrorCode: needsReconnect ? "authentication" : undefined },
      });
    } finally {
      await prisma.socialActivitySync.updateMany({
        where: { accountId, leaseToken: token },
        data: { leaseToken: null, leaseUntil: null },
      });
    }
    statuses.push({
      accountId,
      platform: account.platform,
      processed,
      error: failure,
      hasMore: Boolean(failure || cursor || index < stored.targets.length || stored.nextPostCursor),
    });
  }
  return {
    accounts: statuses,
    hasMore: statuses.length < accounts.length || statuses.some((account) => account.hasMore),
  };
}

async function ownedItem(userId: string, itemId: string, workspaceId: string | null) {
  const item = await prisma.socialActivityItem.findFirst({
    where: {
      id: itemId,
      userId,
      account: { userId, workspaceId },
      post: { userId },
    },
  });
  if (!item) throw new NotFoundError("Social inbox item not found");
  return item;
}

function providerTarget(item: Awaited<ReturnType<typeof ownedItem>>): SocialComment {
  return {
    nativeId: item.nativeId,
    nativePostId: item.nativePostId,
    body: item.body,
    canReply: item.canReply,
    canLike: item.canLike,
    replyTarget: object(item.providerData),
  };
}

function definitelyFailed(error: SocialActivityError): boolean {
  return [
    "permission_required",
    "app_permission_required",
    "authentication",
    "not_found",
    "unsupported",
    "rate_limited",
    "invalid_request",
  ].includes(error.code);
}

function replyStatus(reply: { status: string; updatedAt: Date }) {
  return reply.status === "pending" && Date.now() - reply.updatedAt.getTime() > ACTION_TIMEOUT_MS
    ? "uncertain"
    : reply.status;
}

function replyReceipt(reply: {
  id: string;
  status: string;
  updatedAt: Date;
  nativeReplyUrl: string | null;
  errorMessage: string | null;
  errorCode: string | null;
}) {
  return {
    replyId: reply.id,
    status: replyStatus(reply),
    nativeReplyUrl: safeNativeUrl(reply.nativeReplyUrl ?? undefined),
    errorMessage: reply.errorMessage ?? undefined,
    errorCode: reply.errorCode ?? undefined,
  };
}

export async function sendSocialReply(
  userId: string,
  input: { itemId: string; body: string; idempotencyKey: string; workspaceId?: string | null },
) {
  await requireSocialInbox(userId);
  const body = input.body.trim();
  if (!body || body.length > 5000) throw new BadRequestError("Replies must be between 1 and 5,000 characters.");
  if (!/^[a-zA-Z0-9_-]{12,160}$/u.test(input.idempotencyKey)) throw new BadRequestError("Invalid reply key");
  const workspaceId = input.workspaceId ?? null;
  const item = await ownedItem(userId, input.itemId, workspaceId);
  const key = { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } };
  let reply = await prisma.socialActivityReply.findUnique({ where: key });
  if (reply && (reply.activityItemId !== item.id || reply.body !== body))
    throw new ConflictError("This reply key belongs to a different reply.");
  if (reply && reply.status !== "failed") return replyReceipt(reply);
  if (
    await prisma.socialActivityReply.findFirst({
      where: { activityItemId: item.id, status: "sent" },
      select: { id: true },
    })
  )
    throw new ConflictError("This inbox item already has a reply.");
  if (!item.canReply) throw new BadRequestError("Replies are unavailable for this item.");
  const account = await refreshedAccount(userId, item.accountId, workspaceId);
  await requireSocialInbox(userId);
  try {
    if (reply) {
      const claim = await prisma.socialActivityReply.updateMany({
        where: { id: reply.id, status: "failed" },
        data: { status: "pending", errorCode: null, errorMessage: null },
      });
      if (!claim.count) return replyReceipt(await prisma.socialActivityReply.findUniqueOrThrow({ where: key }));
    } else {
      reply = await prisma.socialActivityReply.create({
        data: {
          accountId: item.accountId,
          activityItemId: item.id,
          userId,
          body,
          idempotencyKey: input.idempotencyKey,
        },
      });
    }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const previous = await prisma.socialActivityReply.findUnique({ where: key });
    if (previous?.activityItemId === item.id && previous.body === body) return replyReceipt(previous);
    throw new ConflictError("A reply is already pending for this item, or this key belongs to a different reply.");
  }

  const response = await replyToSocialComment({
    account: socialAccount(account),
    target: providerTarget(item),
    text: body,
  }).catch(() => ({
    ok: false as const,
    error: { code: "uncertain" as const, message: "Check the platform to confirm delivery." },
  }));
  const result = await prisma.socialActivityReply.update({
    where: { id: reply.id },
    data: response.ok
      ? {
          status: "sent",
          nativeReplyId: response.data.nativeId,
          nativeReplyUrl: safeNativeUrl(response.data.nativeUrl),
        }
      : {
          status: definitelyFailed(response.error) ? "failed" : "uncertain",
          errorCode: response.error.code,
          errorMessage: response.error.message,
        },
  });
  return replyReceipt(result);
}

export async function sendSocialLike(userId: string, itemId: string, workspaceId: string | null = null) {
  await requireSocialInbox(userId);
  const item = await ownedItem(userId, itemId, workspaceId);
  if (item.liked) return { liked: true, status: "sent" };
  if (!item.canLike) throw new BadRequestError("Likes are unavailable for this item.");
  const account = await refreshedAccount(userId, item.accountId, workspaceId);
  await requireSocialInbox(userId);
  if (item.platform === "x" && !hasInboxScopes(account.scope, ["like.write"])) {
    throw new BadRequestError("Reconnect X with permission to like inbox items.");
  }
  const attemptAt = new Date();
  const claim = await prisma.socialActivityItem.updateMany({
    where: {
      id: itemId,
      userId,
      liked: false,
      OR: [
        { likeStatus: null },
        { likeStatus: { not: "pending" } },
        { likeAttemptAt: { lt: new Date(attemptAt.getTime() - ACTION_TIMEOUT_MS) } },
      ],
    },
    data: { likeStatus: "pending", likeAttemptAt: attemptAt, likeError: null },
  });
  if (!claim.count) {
    const latest = await ownedItem(userId, itemId, workspaceId);
    return { liked: latest.liked, status: latest.liked ? "sent" : "pending" };
  }
  const response = await likeSocialItem({ account: socialAccount(account), target: providerTarget(item) }).catch(
    () => ({
      ok: false as const,
      error: { code: "uncertain" as const, message: "Check the platform to confirm the like." },
    }),
  );
  const status = response.ok ? "sent" : definitelyFailed(response.error) ? "failed" : "uncertain";
  const errorMessage = response.ok ? undefined : response.error.message;
  await prisma.socialActivityItem.updateMany({
    where: { id: itemId, userId, liked: false, likeAttemptAt: attemptAt },
    data: { liked: response.ok, likeStatus: status, likeError: errorMessage },
  });
  return { liked: response.ok, status, errorMessage, errorCode: response.ok ? undefined : response.error.code };
}
