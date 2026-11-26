import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import {
  getSocialActivityCapabilities,
  likeSocialItem,
  listSocialPostComments,
  listSocialPostQuotes,
  replyToSocialComment,
} from "@simple-post/sdk";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import { requireSocialInbox } from "@/lib/features";
import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import { BadRequestError, ConflictError, NotFoundError } from "@/lib/utils/errors";
import type { AccountPublishResult, ConnectedAccount, MediaFile } from "@/types";

import { enabledInboxScopes, hasInboxScopes } from "./permissions";

import type { SocialActivityAccount, SocialActivityError, SocialComment } from "@simple-post/sdk";

const MAX_REQUESTS = 8;
const RECENT_SYNC_INTERVAL_MS = 5 * 60_000;
const SYNC_BUDGET_MS = 20_000;
const MAX_ACCOUNTS = 12;
const POSTS_PER_SNAPSHOT = 25;
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

interface OwnedTarget {
  key: string;
  postId: string;
  accountId: string;
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
): OwnedTarget[] {
  const targets: OwnedTarget[] = [];
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
          targets.push(segmentTarget);
          seen.add(segmentTarget.key);
        }
      }
    }
  }
  return targets;
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
async function ownedTargetPage(userId: string, accountId: string, workspaceId: string | null, after?: string) {
  const cursor = decodePostCursor(after);
  const posts = await prisma.post.findMany({
    where: {
      userId,
      accounts: { some: { id: accountId, userId, workspaceId } },
      ...(workspaceId ? {} : { workspaceReviewId: null }),
      status: { in: ["published", "failed"] },
      ...(cursor
        ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
        : {}),
    },
    include: { accounts: { where: { id: accountId, userId, workspaceId } } },
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

async function refreshedAccount(
  userId: string,
  accountId: string,
  workspaceId: string | null,
): Promise<ConnectedAccount> {
  const stored = await prisma.connectedAccount.findFirst({ where: { id: accountId, userId, workspaceId } });
  if (!stored) throw new NotFoundError("Connected account not found");
  const decrypted = decryptConnectedAccountSecrets(stored);
  const result = await withAccountLock(accountId, async () => {
    const latest = await reloadAccountSecrets(decrypted);
    return refreshConnectedAccountIfNeeded(latest, { reason: "manual" });
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
  phase: "comments" | "quotes",
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

async function syncXLikes(account: ConnectedAccount, signal: AbortSignal) {
  if (
    mapPlatformName(account.platform) !== "x" ||
    !/^\d+$/.test(account.platformAccountId) ||
    !hasInboxScopes(account.scope, ["like.read"])
  )
    return;

  const startedAt = new Date();
  const url = new URL(`https://api.x.com/2/users/${account.platformAccountId}/liked_tweets?max_results=100`);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
    redirect: "error",
    signal,
  });
  if (!response.ok) return;
  const payload = object(await response.json());
  const meta = object(payload.meta);
  const likes = Array.isArray(payload.data) ? payload.data : [];
  if (typeof meta.result_count !== "number" || likes.length !== meta.result_count || Array.isArray(payload.errors))
    return;

  const ids = likes.map((like: unknown) => object(like).id).filter((id) => isUsableNativeId(id));
  if (ids.length !== likes.length) return;
  const where = {
    accountId: account.id,
    OR: [
      { likeAttemptAt: null },
      { likeAttemptAt: { lt: startedAt }, OR: [{ likeStatus: null }, { likeStatus: { not: "pending" } }] },
    ],
  };
  await prisma.$transaction([
    prisma.socialActivityItem.updateMany({
      where: { ...where, nativeId: { in: ids } },
      data: { liked: true, likeStatus: "sent", likeError: null },
    }),
    // A truncated list only establishes positive matches.
    ...(meta.next_token
      ? []
      : [
          prisma.socialActivityItem.updateMany({
            where: { ...where, liked: true, nativeId: { notIn: ids } },
            data: { liked: false, likeStatus: null, likeError: null },
          }),
        ]),
  ]);
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
        ...(options.workspaceId ? {} : { post: { workspaceReviewId: null } }),
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
        post: { select: { message: true, accountOverrides: true, media: true, publishedAt: true } },
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
        media: media.filter(
          (entry) => (entry.type === "image" || entry.type === "video") && typeof entry.url === "string",
        ) as MediaFile[],
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
        hasMore: hasMoreInboxWork(account.socialActivitySync),
        permissionUrl:
          ["authentication", "permission_required"].includes(account.socialActivitySync?.lastErrorCode ?? "") ||
          (enabledInboxScopes(account.platform).length > 0 &&
            !hasInboxScopes(account.scope, enabledInboxScopes(account.platform)))
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
  if (!sync?.targetSnapshot) return Boolean(sync);
  const snapshot = targetSnapshot(sync.targetSnapshot);
  return Boolean(sync.providerCursor || sync.targetIndex < snapshot.targets.length || snapshot.nextPostCursor);
}

function supportsInbox(platform: string) {
  const capabilities = getSocialActivityCapabilities(platform);
  return capabilities.has("comments") || capabilities.has("quotes");
}

function retryAt(error: SocialActivityError) {
  if (error.code !== "rate_limited" && error.code !== "transient") return null;
  return new Date(Date.now() + Math.min(error.retryAfterSeconds ?? 60, 86_400) * 1000);
}

export async function refreshSocialInbox(
  userId: string,
  options: { reset?: boolean; platform?: string; automatic?: boolean; workspaceId?: string | null } = {},
) {
  await requireSocialInbox(userId);
  const stale = new Date(0);
  const workspaceId = options.workspaceId ?? null;
  const connected = await prisma.connectedAccount.findMany({
    where: { userId, workspaceId, platform: options.platform === "x" ? { in: ["x", "twitter"] } : options.platform },
    select: feedAccountSelect,
  });
  const dueBefore = new Date(Date.now() - RECENT_SYNC_INTERVAL_MS);
  const accounts = connected
    .filter((account) => supportsInbox(account.platform))
    .filter(
      (account) =>
        !options.automatic ||
        !account.socialActivitySync?.lastAttemptAt ||
        account.socialActivitySync.lastAttemptAt <= dueBefore,
    )
    .sort(
      (a, b) =>
        (a.socialActivitySync?.lastAttemptAt ?? stale).getTime() -
          (b.socialActivitySync?.lastAttemptAt ?? stale).getTime() || a.id.localeCompare(b.id),
    );
  let remaining = MAX_REQUESTS;
  const deadline = Date.now() + SYNC_BUDGET_MS;
  const statuses: { accountId: string; platform: string; processed: number; hasMore: boolean; error?: string }[] = [];
  for (const account of accounts.slice(0, MAX_ACCOUNTS)) {
    if (remaining <= 0 || Date.now() >= deadline) break;
    const accountId = account.id;
    const token = randomUUID();
    const now = new Date();
    await prisma.socialActivitySync.upsert({ where: { accountId }, create: { accountId }, update: {} });
    const claim = await prisma.socialActivitySync.updateMany({
      where: {
        accountId,
        AND: [
          { OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] },
          { OR: [{ retryAt: null }, { retryAt: { lte: now } }] },
          ...(options.automatic ? [{ OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lte: dueBefore } }] }] : []),
        ],
      },
      data: { leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS), lastAttemptAt: now },
    });
    if (!claim.count) {
      statuses.push({
        accountId,
        platform: account.platform,
        processed: 0,
        hasMore: true,
        error: account.socialActivitySync?.lastError ?? undefined,
      });
      continue;
    }
    const sync = await prisma.socialActivitySync.findUniqueOrThrow({ where: { accountId } });
    let stored = targetSnapshot(sync.targetSnapshot);
    let index = sync.targetIndex;
    let cursor = sync.providerCursor ?? undefined;
    let phase: "comments" | "quotes" = sync.phase === "quotes" ? "quotes" : "comments";
    let processed = 0;
    let failure: string | undefined;
    try {
      // Automatic reads start with recent posts on each cycle. Manual older
      // reads can still resume the pagination cursor saved by the last read.
      const startRecent = options.reset || options.automatic;
      if (startRecent || !sync.targetSnapshot || index >= stored.targets.length) {
        const after = startRecent ? undefined : stored.nextPostCursor;
        if (startRecent || !sync.targetSnapshot || after) {
          const page = await ownedTargetPage(userId, accountId, workspaceId, after);
          stored = serializeTargetSnapshot(page.targets, page.nextPostCursor);
          index = 0;
          cursor = undefined;
          phase = "comments";
        }
      }
      const capabilities = getSocialActivityCapabilities(account.platform);
      const fresh = index < stored.targets.length ? await refreshedAccount(userId, accountId, workspaceId) : undefined;
      // A small per-account budget keeps busy destinations from starving others.
      while (fresh && index < stored.targets.length && remaining > 0 && processed < 3 && Date.now() < deadline) {
        await requireSocialInbox(userId);
        remaining -= 1;
        const target = { ...stored.targets[index], accountId };
        if (phase === "comments" && !capabilities.has("comments")) phase = "quotes";
        const list = phase === "quotes" ? listSocialPostQuotes : listSocialPostComments;
        const response = await list(socialAccount(fresh), target, { cursor, limit: 50 });
        if (!response.ok) {
          failure = response.error.message;
          // A deleted source or unavailable quote edge must not block later posts.
          if (["not_found", "unsupported", "invalid_request", "permission_required"].includes(response.error.code)) {
            if (phase === "comments" && capabilities.has("quotes")) phase = "quotes";
            else {
              index += 1;
              phase = "comments";
            }
            cursor = undefined;
          }
        }
        const itemPhase = phase;
        if (response.ok) {
          const next = safeProviderCursor(response.data.nextCursor);
          if (next && next !== cursor) cursor = next;
          else {
            cursor = undefined;
            if (phase === "comments" && capabilities.has("quotes")) phase = "quotes";
            else {
              index += 1;
              phase = "comments";
            }
          }
          processed += 1;
        }
        await prisma.$transaction(
          async (tx) => {
            const saved = await tx.socialActivitySync.updateMany({
              where: { accountId, leaseToken: token },
              data: {
                targetSnapshot: stored as unknown as Prisma.InputJsonValue,
                targetIndex: index,
                providerCursor: cursor ?? null,
                phase,
                lastSyncedAt: response.ok ? new Date() : undefined,
                lastError: failure ?? null,
                lastErrorCode: response.ok ? null : response.error.code,
                coverage: response.ok ? (response.data.coverage ?? undefined) : undefined,
                retryAt: response.ok ? null : retryAt(response.error),
              },
            });
            if (saved.count && response.ok) await saveItems(tx, userId, fresh, target, itemPhase, response.data.data);
          },
          { timeout: 15_000 },
        );
        if (!response.ok) break;
      }
      if (
        fresh &&
        remaining > 0 &&
        Date.now() < deadline &&
        mapPlatformName(account.platform) === "x" &&
        hasInboxScopes(fresh.scope, ["like.read"])
      ) {
        remaining -= 1;
        await syncXLikes(fresh, AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - Date.now())))).catch(
          () => {},
        );
      }
      if (!fresh) {
        await prisma.socialActivitySync.updateMany({
          where: { accountId, leaseToken: token },
          data: {
            targetSnapshot: stored as unknown as Prisma.InputJsonValue,
            targetIndex: index,
            providerCursor: cursor ?? null,
            phase,
            lastSyncedAt: new Date(),
            lastError: null,
            lastErrorCode: null,
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
      post: { userId, ...(workspaceId ? {} : { workspaceReviewId: null }) },
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
