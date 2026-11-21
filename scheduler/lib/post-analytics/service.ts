import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { getAccountAnalytics, getPostAnalytics, type Platform } from "@simple-post/sdk";
import {
  computeEngagements,
  normalizeAccountMetrics,
  normalizePostMetrics,
  PLATFORM_ANALYTICS_CAPABILITIES,
  supportsAccountAnalytics,
  supportsPostAnalytics,
  type AccountAnalyticsResponse,
  type PostAnalytics as SdkPostAnalytics,
  type PostMetrics,
} from "@simple-post/sdk/analytics";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import { isPreviewOnlyConnectedAccount } from "@/lib/accounts/account-state";
import { createLogger, serializeError } from "@/lib/logger";
import { refreshConnectedAccountIfNeeded } from "@/lib/oauth/credential-health";
import { persistRefreshedCredentials } from "@/lib/posting";
import { reloadAccountSecrets, withAccountLock } from "@/lib/posting/account-lock";
import { buildPostOptions } from "@/lib/posting/credentials";
import { prisma } from "@/lib/prisma";
import { decryptConnectedAccountSecrets } from "@/lib/security/connected-account-secrets";
import type { ConnectedAccount } from "@/types";

import { startOfUtcDay, xDailyPostReadLimit } from "./config";
import { ACCOUNT_ANALYTICS_TTL_MS, canForceRefresh, isStale, nextRefreshAt, snapshotIntervalMs } from "./freshness";
import { analyticsAccountReadiness } from "./permissions";
import { analyticsSeedsForPost, analyticsTargetFor, type AnalyticsSourcePost } from "./targets";

const log = createLogger("post-analytics");

/** Leases protect a row from being read twice by overlapping refreshes (tabs, replicas, cron). */
const LEASE_MS = 2 * 60_000;
/** Concurrent connected accounts refreshed at once. */
const ACCOUNT_CONCURRENCY = 3;
const PLATFORMS_WITHOUT_POST_ANALYTICS = Object.entries(PLATFORM_ANALYTICS_CAPABILITIES)
  .filter(([, capability]) => !capability.posts)
  .map(([platform]) => platform);

/** Posts updated this recently are re-seeded even when they already have analytics rows. */
const RECENT_UPDATE_WINDOW_MS = 2 * 24 * 60 * 60_000;
/** INT columns are 32-bit; clamp absurd provider values instead of failing the write. */
const MAX_INT = 2_147_483_647;

export const METRIC_COLUMNS = [
  "views",
  "reach",
  "likes",
  "comments",
  "shares",
  "quotes",
  "saves",
  "clicks",
  "profileVisits",
  "follows",
  "watchTimeSeconds",
  "averageWatchTimeSeconds",
] as const satisfies readonly (keyof PostMetrics)[];

type MetricColumns = { [K in (typeof METRIC_COLUMNS)[number]]: number | null } & { engagements: number | null };

export interface RefreshOutcome {
  /** Rows that were read from providers in this call. */
  refreshed: number;
  /** Rows read successfully. */
  succeeded: number;
  /** Rows whose read failed (status other than ok). */
  failed: number;
  /** Rows skipped because they were fresh, leased elsewhere, or past the deadline. */
  skipped: number;
}

const emptyOutcome = (): RefreshOutcome => ({ refreshed: 0, succeeded: 0, failed: 0, skipped: 0 });

function clampInt(value: number | undefined): number | null {
  if (value === undefined) return null;
  return Math.min(MAX_INT, Math.max(0, Math.round(value)));
}

export function metricColumnsFromMetrics(metrics: PostMetrics): MetricColumns {
  const normalized = normalizePostMetrics(metrics as Record<string, unknown>);
  return {
    views: clampInt(normalized.views),
    reach: clampInt(normalized.reach),
    likes: clampInt(normalized.likes),
    comments: clampInt(normalized.comments),
    shares: clampInt(normalized.shares),
    quotes: clampInt(normalized.quotes),
    saves: clampInt(normalized.saves),
    clicks: clampInt(normalized.clicks),
    profileVisits: clampInt(normalized.profileVisits),
    follows: clampInt(normalized.follows),
    watchTimeSeconds: normalized.watchTimeSeconds ?? null,
    averageWatchTimeSeconds: normalized.averageWatchTimeSeconds ?? null,
    engagements: clampInt(computeEngagements(normalized)),
  };
}

export function metricsFromColumns(row: Partial<Record<keyof MetricColumns, number | null>>): PostMetrics {
  const metrics: PostMetrics = {};
  for (const column of METRIC_COLUMNS) {
    const value = row[column];
    if (typeof value === "number") metrics[column] = value;
  }
  return metrics;
}

/**
 * Creates analytics rows for every successfully published account of the
 * given posts (idempotent). Rows for platforms without post analytics are
 * still created so the UI can explain why no numbers are shown.
 */
export async function ensureAnalyticsRows(posts: AnalyticsSourcePost[]): Promise<void> {
  const seeds = posts.flatMap((post) => analyticsSeedsForPost(post));
  if (seeds.length === 0) return;

  await prisma.postAnalytics.createMany({
    data: seeds.map((seed) => ({
      ...seed,
      sourcePostId: seed.platformPostId,
      status: supportsPostAnalytics(seed.platform) ? "pending" : "unsupported",
      nextRefreshAt: supportsPostAnalytics(seed.platform) ? new Date() : new Date("9999-01-01T00:00:00Z"),
    })),
    skipDuplicates: true,
  });

  // A retried publish can replace an account's platform post id; follow it. Compare with
  // the id the row was seeded from, not platformPostId, which a read may have resolved
  // (e.g. a TikTok upload id → its public video id).
  const existing = await prisma.postAnalytics.findMany({
    where: { postId: { in: [...new Set(seeds.map((seed) => seed.postId))] } },
    select: { id: true, postId: true, accountId: true, sourcePostId: true },
  });
  const byKey = new Map(existing.map((row) => [`${row.postId}:${row.accountId}`, row]));
  for (const seed of seeds) {
    const row = byKey.get(`${seed.postId}:${seed.accountId}`);
    if (row && row.sourcePostId !== seed.platformPostId) {
      await prisma.postAnalytics.update({
        where: { id: row.id },
        data: {
          sourcePostId: seed.platformPostId,
          platformPostId: seed.platformPostId,
          status: "pending",
          nextRefreshAt: new Date(),
          failureCount: 0,
        },
      });
    }
  }
}

/** Published (or partially published) posts of a user that may need analytics rows. */
export async function ensureAnalyticsRowsForUser(
  userId: string,
  options: { since?: Date; postIds?: string[]; limit?: number } = {},
): Promise<void> {
  const posts = await prisma.post.findMany({
    where: {
      userId,
      status: { in: ["published", "failed"] },
      ...(options.postIds ? { id: { in: options.postIds } } : {}),
      ...(options.since
        ? { OR: [{ publishedAt: { gte: options.since } }, { updatedAt: { gte: options.since } }] }
        : {}),
      // Posts with rows are skipped, except recently updated ones: a retry can publish
      // to accounts that failed before, and those accounts need rows too.
      ...(options.postIds
        ? {}
        : {
            AND: [
              {
                OR: [
                  { analytics: { none: {} } },
                  { updatedAt: { gte: new Date(Date.now() - RECENT_UPDATE_WINDOW_MS) } },
                ],
              },
            ],
          }),
    },
    select: {
      id: true,
      userId: true,
      status: true,
      publishedAt: true,
      updatedAt: true,
      accountResults: true,
      accounts: { select: { id: true, platform: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: options.limit ?? 500,
  });
  await ensureAnalyticsRows(posts);
}

interface ClaimedRow {
  id: string;
  userId: string;
  postId: string;
  accountId: string;
  platform: string;
  platformPostId: string;
  publishedAt: Date;
  status: string;
  failureCount: number;
  fetchedAt: Date | null;
  leaseToken: string | null;
}

/**
 * Refreshes analytics rows that are due (or, with `force`, all requested rows
 * outside the forced-refresh floor). Rows are claimed with a lease so
 * concurrent callers never read the same post twice. Never throws for
 * provider errors; those are stored on the row.
 */
export async function refreshPostAnalytics(params: {
  userId?: string;
  rowIds?: string[];
  postIds?: string[];
  force?: boolean;
  limit?: number;
  /** Stop starting new account batches after this many milliseconds. */
  budgetMs?: number;
  reason?: "manual" | "background";
  /** Only refresh these platforms / skip these platforms. */
  platforms?: { include?: string[]; exclude?: string[] };
  /** Only rows of posts published at or after this time. */
  publishedAfter?: Date;
}): Promise<RefreshOutcome> {
  const now = new Date();
  const limit = params.limit ?? 200;
  const outcome = emptyOutcome();

  const candidates = await prisma.postAnalytics.findMany({
    where: {
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.rowIds ? { id: { in: params.rowIds } } : {}),
      ...(params.postIds ? { postId: { in: params.postIds } } : {}),
      // Platforms without post analytics are never read; every other row, including ones
      // that reported "unsupported" for a while (e.g. preview accounts), is retried on schedule.
      platform: { notIn: PLATFORMS_WITHOUT_POST_ANALYTICS },
      ...(params.publishedAfter ? { publishedAt: { gte: params.publishedAfter } } : {}),
      ...(params.platforms?.include || params.platforms?.exclude
        ? {
            platform: {
              ...(params.platforms.include ? { in: params.platforms.include } : {}),
              notIn: [...PLATFORMS_WITHOUT_POST_ANALYTICS, ...(params.platforms.exclude ?? [])],
            },
          }
        : {}),
      ...(params.force || params.rowIds || params.postIds ? {} : { nextRefreshAt: { lte: now } }),
    },
    include: { account: { select: { updatedAt: true } } },
    orderBy: [{ nextRefreshAt: "asc" }],
    take: params.rowIds || params.postIds ? undefined : limit,
  });

  const due = candidates.filter((row) =>
    params.force ? canForceRefresh(row, now) : isStale(row, row.account ?? undefined, now),
  );
  outcome.skipped += candidates.length - due.length;
  if (due.length === 0) return outcome;

  const leaseToken = randomUUID();
  await prisma.postAnalytics.updateMany({
    where: {
      id: { in: due.slice(0, limit).map((row) => row.id) },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: { leaseToken, leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  const claimed: ClaimedRow[] = await prisma.postAnalytics.findMany({ where: { leaseToken } });
  outcome.skipped += due.length - claimed.length;
  if (claimed.length === 0) return outcome;

  const byAccount = new Map<string, ClaimedRow[]>();
  for (const row of claimed) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);

  const deadline = Date.now() + (params.budgetMs ?? 25_000);
  const groups = [...byAccount.entries()];
  let next = 0;
  const runners = Array.from({ length: Math.min(ACCOUNT_CONCURRENCY, groups.length) }, async () => {
    while (next < groups.length) {
      const [accountId, rows] = groups[next++];
      if (Date.now() > deadline) {
        await releaseLease(rows, leaseToken);
        outcome.skipped += rows.length;
        continue;
      }
      try {
        const results = await refreshAccountRows(accountId, rows, params.reason ?? "manual");
        for (const result of results) {
          outcome.refreshed += 1;
          if (result.status === "ok") outcome.succeeded += 1;
          else outcome.failed += 1;
        }
      } catch (error) {
        log.error({ err: serializeError(error), accountId }, "Post analytics refresh failed for account");
        // Back off so a broken account cannot occupy the front of the queue on every run.
        await storeResults(
          rows,
          rows.map((row) =>
            failure(
              row.platform as Platform,
              row.platformPostId,
              "error",
              "SimplePost could not read analytics for this account. It will try again later.",
              new Date().toISOString(),
            ),
          ),
          { keepFetchedAt: true },
        ).catch(() => releaseLease(rows, leaseToken));
        outcome.failed += rows.length;
      }
    }
  });
  await Promise.all(runners);
  return outcome;
}

async function releaseLease(rows: ClaimedRow[], leaseToken: string): Promise<void> {
  await prisma.postAnalytics.updateMany({
    where: { id: { in: rows.map((row) => row.id) }, leaseToken },
    data: { leaseToken: null, leaseUntil: null },
  });
}

async function loadConnectedAccount(accountId: string): Promise<ConnectedAccount | null> {
  const stored = await prisma.connectedAccount.findUnique({ where: { id: accountId } });
  return stored ? (decryptConnectedAccountSecrets(stored) as ConnectedAccount) : null;
}

/** Reads one account's rows from the provider and stores the results. */
async function refreshAccountRows(
  accountId: string,
  claimedRows: ClaimedRow[],
  reason: "manual" | "background",
): Promise<SdkPostAnalytics[]> {
  let rows = claimedRows;
  const account = await loadConnectedAccount(accountId);
  const platform = mapPlatformName(rows[0].platform) as Platform;
  const now = () => new Date().toISOString();

  if (!account) {
    const results = rows.map((row) =>
      failure(platform, row.platformPostId, "error", "The account was disconnected.", now()),
    );
    await storeResults(rows, results);
    return results;
  }

  const readiness = analyticsAccountReadiness(account);
  if (!readiness.ready) {
    const results = rows.map((row) =>
      failure(platform, row.platformPostId, readiness.status, readiness.message, now()),
    );
    await storeResults(rows, results);
    return results;
  }

  if (platform === "x") {
    // Serialize budget decisions per user in this process and reserve the reads
    // immediately, so parallel refreshes of the same user cannot overspend.
    const { allowed, deferred } = await withAccountLock(`x-analytics-budget:${account.userId}`, () =>
      applyXDailyBudget(account.userId, rows),
    );
    if (deferred.length > 0) await deferUntilTomorrow(deferred);
    if (allowed.length === 0) return [];
    rows = allowed;
  }

  const posts = await prisma.post.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.postId))] } },
    select: { id: true, accountResults: true, media: { select: { type: true } } },
  });
  const postsById = new Map(posts.map((post) => [post.id, post]));

  // The account lock only covers the credential refresh. Provider reads can take a
  // while (one request per post on several platforms) and must not hold up publishing.
  const credentials = await freshCredentials(account, reason);
  if ("error" in credentials) {
    const results = rows.map((row) =>
      failure(platform, row.platformPostId, "credentials_error", credentials.error, now()),
    );
    await storeResults(rows, results);
    return results;
  }
  const response = await getPostAnalytics({
    platform,
    targets: rows.map((row) => analyticsTargetFor(row, postsById.get(row.postId))),
    options: buildPostOptions(credentials.account),
  });
  if (response.refreshedCredentials) {
    // Should not happen (no refresh material is passed), but never lose rotated tokens.
    await withAccountLock(account.id, () =>
      persistRefreshedCredentials(credentials.account, response.refreshedCredentials!, log),
    );
  }

  await storeResults(rows, response.results);
  return response.results;
}

/**
 * Splits X rows into those within today's per-user read budget and those that
 * must wait. Posts already read today are free to read again (X bills each
 * post at most once per UTC day), so they never consume budget.
 */
async function applyXDailyBudget(
  userId: string,
  rows: ClaimedRow[],
): Promise<{ allowed: ClaimedRow[]; deferred: ClaimedRow[] }> {
  const dayStart = startOfUtcDay(new Date());
  const readToday = rows.filter((row) => row.fetchedAt && row.fetchedAt >= dayStart);
  const unread = rows.filter((row) => !row.fetchedAt || row.fetchedAt < dayStart);
  if (unread.length === 0) return { allowed: rows, deferred: [] };
  // Reads that never reached X (credentials, permissions) are not billed.
  const used = await prisma.postAnalytics.count({
    where: {
      userId,
      platform: "x",
      fetchedAt: { gte: dayStart },
      status: { notIn: ["credentials_error", "missing_permission", "unsupported"] },
    },
  });
  const remaining = Math.max(0, xDailyPostReadLimit() - used);
  const reserved = unread.slice(0, remaining);
  if (reserved.length > 0) {
    await prisma.postAnalytics.updateMany({
      where: { id: { in: reserved.map((row) => row.id) } },
      data: { fetchedAt: new Date() },
    });
  }
  return { allowed: [...readToday, ...reserved], deferred: unread.slice(remaining) };
}

async function deferUntilTomorrow(rows: ClaimedRow[]): Promise<void> {
  const tomorrow = new Date(startOfUtcDay(new Date()).getTime() + 24 * 60 * 60_000);
  const limit = xDailyPostReadLimit();
  await prisma.postAnalytics.updateMany({
    where: { id: { in: rows.map((row) => row.id) } },
    data: {
      nextRefreshAt: tomorrow,
      leaseToken: null,
      leaseUntil: null,
      // Keep the previous numbers visible; only explain why they are not newer.
      message:
        limit === 0
          ? "X analytics are turned off on this SimplePost installation."
          : `The daily X analytics limit (${limit} posts) was reached. Numbers refresh again tomorrow.`,
    },
  });
}

async function freshCredentials(
  account: ConnectedAccount,
  reason: "manual" | "background",
): Promise<{ account: ConnectedAccount } | { error: string }> {
  return withAccountLock(account.id, async () => {
    const fresh = await reloadAccountSecrets(account);
    const refreshResult = await refreshConnectedAccountIfNeeded(fresh, { reason });
    return refreshResult.error ? { error: refreshResult.error } : { account: refreshResult.account };
  });
}

function failure(
  platform: Platform,
  postId: string,
  status: SdkPostAnalytics["status"],
  message: string,
  fetchedAt: string,
): SdkPostAnalytics {
  return { platform, postId, status, metrics: {}, message, fetchedAt };
}

async function storeResults(
  rows: ClaimedRow[],
  results: SdkPostAnalytics[],
  options: { keepFetchedAt?: boolean } = {},
): Promise<void> {
  const now = new Date();
  for (const [index, row] of rows.entries()) {
    const result = results.find((candidate) => candidate.postId === row.platformPostId) ?? results[index];
    if (!result) continue;
    const ok = result.status === "ok";
    const failureCount = ok ? 0 : row.failureCount + 1;
    const columns = ok ? metricColumnsFromMetrics(result.metrics) : undefined;

    try {
      const updated = await prisma.postAnalytics.updateMany({
        where: { id: row.id, leaseToken: row.leaseToken },
        data: {
          status: result.status,
          message: result.message ?? null,
          ...columns,
          ...(ok
            ? {
                platformMetrics: result.platformMetrics
                  ? (result.platformMetrics as Prisma.InputJsonValue)
                  : Prisma.DbNull,
              }
            : {}),
          ...(result.resolvedPostId && result.resolvedPostId !== row.platformPostId
            ? { platformPostId: result.resolvedPostId }
            : {}),
          ...(options.keepFetchedAt ? {} : { fetchedAt: now }),
          failureCount,
          nextRefreshAt: nextRefreshAt({ publishedAt: row.publishedAt, status: result.status, failureCount, now }),
          leaseToken: null,
          leaseUntil: null,
        },
      });
      // A lost lease means another worker owns the row now; its read wins.
      if (columns && updated.count === 1) await maybeSnapshot(row, columns, now);
    } catch (error) {
      log.error({ err: serializeError(error), analyticsId: row.id }, "Could not store post analytics");
    }
  }
}

async function maybeSnapshot(row: ClaimedRow, columns: MetricColumns, now: Date): Promise<void> {
  const latest = await prisma.postAnalyticsSnapshot.findFirst({
    where: { analyticsId: row.id },
    orderBy: { capturedAt: "desc" },
    select: { id: true, capturedAt: true },
  });
  const interval = snapshotIntervalMs(row.publishedAt, now);
  // Fixed clock buckets (hour/day): refreshes inside the same bucket update its snapshot;
  // the next bucket always gets a new one, so history accumulates.
  const bucket = (date: Date) => Math.floor(date.getTime() / interval);
  if (latest && bucket(latest.capturedAt) === bucket(now)) {
    await prisma.postAnalyticsSnapshot.update({ where: { id: latest.id }, data: { ...columns, capturedAt: now } });
    return;
  }
  await prisma.postAnalyticsSnapshot.create({
    data: { analyticsId: row.id, userId: row.userId, capturedAt: now, ...columns },
  });
}

/* ------------------------------------------------------------------------ */
/* Account-level analytics                                                   */
/* ------------------------------------------------------------------------ */

function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Captures today's account-level analytics (followers, …) for the user's
 * accounts whose latest snapshot is older than the account TTL.
 */
export async function refreshAccountAnalytics(params: {
  userId?: string;
  accountIds?: string[];
  force?: boolean;
  limit?: number;
  reason?: "manual" | "background";
  platforms?: string[];
}): Promise<{ refreshed: number }> {
  const now = new Date();
  const ttl = params.force ? 2 * 60_000 : ACCOUNT_ANALYTICS_TTL_MS;
  const cutoff = new Date(now.getTime() - ttl);
  // Select due accounts in the database (no snapshot newer than the TTL, or reconnected
  // after a failed read), least recently updated first, so a limit never starves others.
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.accountIds ? { id: { in: params.accountIds } } : {}),
      OR: [
        { analyticsSnapshots: { none: { capturedAt: { gte: cutoff } } } },
        { analyticsSnapshots: { some: { capturedAt: { gte: cutoff }, status: { not: "ok" } } } },
      ],
    },
    include: { analyticsSnapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "asc" },
    take: params.limit ?? 50,
  });

  const due = accounts.filter((account) => {
    const platform = mapPlatformName(account.platform);
    if (!supportsAccountAnalytics(platform)) return false;
    if (params.platforms && !params.platforms.includes(platform)) return false;
    const latest = account.analyticsSnapshots[0];
    if (!latest) return true;
    if (account.updatedAt > latest.capturedAt && latest.status !== "ok") return true;
    return latest.capturedAt <= cutoff;
  });

  let refreshed = 0;
  let next = 0;
  const runners = Array.from({ length: Math.min(ACCOUNT_CONCURRENCY, due.length) }, async () => {
    while (next < due.length) {
      const stored = due[next++];
      try {
        const account = decryptConnectedAccountSecrets(stored) as ConnectedAccount;
        if (isPreviewOnlyConnectedAccount(account)) continue;
        const result = await readAccountAnalytics(account, params.reason ?? "manual");
        await storeAccountSnapshot(account, result);
        refreshed += 1;
      } catch (error) {
        log.error({ err: serializeError(error), accountId: stored.id }, "Account analytics refresh failed");
      }
    }
  });
  await Promise.all(runners);
  return { refreshed };
}

async function readAccountAnalytics(
  account: ConnectedAccount,
  reason: "manual" | "background",
): Promise<AccountAnalyticsResponse> {
  const platform = mapPlatformName(account.platform) as Platform;
  return withAccountLock(account.id, async () => {
    let fresh = await reloadAccountSecrets(account);
    const refreshResult = await refreshConnectedAccountIfNeeded(fresh, { reason });
    if (refreshResult.error) {
      return {
        platform,
        status: "credentials_error" as const,
        metrics: {},
        message: refreshResult.error,
        fetchedAt: new Date().toISOString(),
      };
    }
    fresh = refreshResult.account;
    const result = await getAccountAnalytics({ platform, options: buildPostOptions(fresh) });
    if (result.refreshedCredentials) await persistRefreshedCredentials(fresh, result.refreshedCredentials, log);
    return result;
  });
}

async function storeAccountSnapshot(account: ConnectedAccount, result: AccountAnalyticsResponse): Promise<void> {
  const now = new Date();
  const day = utcDay(now);
  const metrics = normalizeAccountMetrics(result.metrics as Record<string, unknown>);
  const ok = result.status === "ok";
  const values = {
    status: result.status,
    message: result.message ?? null,
    capturedAt: now,
    ...(ok
      ? {
          followers: clampInt(metrics.followers),
          following: clampInt(metrics.following),
          posts: clampInt(metrics.posts),
          totalViews: clampInt(metrics.totalViews),
          totalLikes: clampInt(metrics.totalLikes),
          platformMetrics: result.platformMetrics ? (result.platformMetrics as Prisma.InputJsonValue) : Prisma.DbNull,
        }
      : {}),
  };
  await prisma.accountAnalyticsSnapshot.upsert({
    where: { accountId_day: { accountId: account.id, day } },
    create: {
      userId: account.userId,
      accountId: account.id,
      platform: mapPlatformName(account.platform),
      day,
      ...values,
    },
    // A failed read must not wipe numbers captured earlier the same day.
    update: values,
  });
}

/**
 * User-initiated refresh (opening a post, the analytics page, an API/MCP/CLI
 * request): creates missing rows, then reads stale posts within a time budget
 * so the caller gets fresh numbers without waiting on every provider.
 */
export async function refreshAnalyticsForUser(
  userId: string,
  options: {
    since?: Date;
    postIds?: string[];
    force?: boolean;
    budgetMs?: number;
    limit?: number;
    accounts?: boolean;
    /** Only these platforms (a dashboard drill-down should not read, and pay for, other platforms). */
    platforms?: string[];
  } = {},
): Promise<{ posts: RefreshOutcome; accounts: number }> {
  const platforms = options.platforms?.length
    ? options.platforms.map((platform) => mapPlatformName(platform))
    : undefined;
  await ensureAnalyticsRowsForUser(userId, { since: options.since, postIds: options.postIds });
  const posts = await refreshPostAnalytics({
    userId,
    postIds: options.postIds,
    force: options.force,
    limit: options.limit ?? 150,
    budgetMs: options.budgetMs ?? 15_000,
    publishedAfter: options.since,
    reason: "manual",
    ...(platforms ? { platforms: { include: platforms } } : {}),
  });
  if (options.accounts === false) return { posts, accounts: 0 };
  const accounts = await refreshAccountAnalytics({ userId, force: options.force, reason: "manual", platforms });
  return { posts, accounts: accounts.refreshed };
}
