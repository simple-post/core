import {
  ADDITIVE_POST_METRICS,
  getAnalyticsCapability,
  POST_METRICS,
  type AccountMetric,
  type PostMetric,
  type PostMetrics,
} from "@simple-post/sdk/analytics";
import { mapPlatformName } from "@simple-post/sdk/platform-names";

import { prisma } from "@/lib/prisma";
import { decryptTokenMetadata } from "@/lib/security/connected-account-secrets";
import type { AccountResultsMap } from "@/types";

import { isStale } from "./freshness";
import {
  bucketStart,
  bucketStarts,
  localWeekdayHour,
  resolvePeriod,
  type AnalyticsGranularity,
  type AnalyticsPeriod,
  type ResolvedPeriod,
} from "./periods";
import { accountAnalyticsReadiness, analyticsAccountReadiness, PAUSED_ANALYTICS_PLATFORMS } from "./permissions";
import { metricsFromColumns } from "./service";

import type { Platform } from "@simple-post/sdk";

/* ------------------------------------------------------------------------ */
/* Shared shapes                                                             */
/* ------------------------------------------------------------------------ */

export const SORTABLE_METRICS = [...POST_METRICS, "engagements", "engagementRate", "publishedAt"] as const;
export type SortableMetric = (typeof SORTABLE_METRICS)[number];
export type SummaryMode = "published" | "activity";

export interface MetricTotals {
  /** Summed comparable metrics (absent when no post in the set reports the metric). */
  metrics: PostMetrics;
  engagements: number | null;
  /** engagements ÷ views (or reach) over posts that report both. Null without a denominator. */
  engagementRate: number | null;
}

interface RowLike {
  id: string;
  postId: string;
  accountId: string;
  platform: string;
  platformPostId: string;
  publishedAt: Date;
  status: string;
  message: string | null;
  fetchedAt: Date | null;
  nextRefreshAt: Date;
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  quotes: number | null;
  saves: number | null;
  clicks: number | null;
  profileVisits: number | null;
  follows: number | null;
  watchTimeSeconds: number | null;
  averageWatchTimeSeconds: number | null;
  engagements: number | null;
  platformMetrics?: unknown;
}

const ROW_SELECT = {
  id: true,
  postId: true,
  accountId: true,
  platform: true,
  platformPostId: true,
  publishedAt: true,
  status: true,
  message: true,
  fetchedAt: true,
  nextRefreshAt: true,
  views: true,
  reach: true,
  likes: true,
  comments: true,
  shares: true,
  quotes: true,
  saves: true,
  clicks: true,
  profileVisits: true,
  follows: true,
  watchTimeSeconds: true,
  averageWatchTimeSeconds: true,
  engagements: true,
} as const;

const SNAPSHOT_COLUMNS = [...POST_METRICS, "engagements"] as const;
type SnapshotColumn = (typeof SNAPSHOT_COLUMNS)[number];
type ColumnValues = Partial<Record<SnapshotColumn, number | null>>;

/** Mutable accumulator that sums metrics and the engagement-rate numerator/denominator. */
class Accumulator {
  metrics: PostMetrics = {};
  engagements: number | null = null;
  private rateNumerator = 0;
  private rateDenominator = 0;
  private averageWeight = 0;
  private averageSum = 0;

  add(values: ColumnValues): void {
    for (const metric of ADDITIVE_POST_METRICS) {
      const value = values[metric];
      if (typeof value === "number") this.metrics[metric] = (this.metrics[metric] ?? 0) + value;
    }
    if (typeof values.engagements === "number") this.engagements = (this.engagements ?? 0) + values.engagements;
    const denominator = values.views ?? values.reach;
    if (typeof values.engagements === "number" && typeof denominator === "number" && denominator > 0) {
      this.rateNumerator += values.engagements;
      this.rateDenominator += denominator;
    }
    // Average watch time is weighted by views so long videos with few views don't dominate.
    if (typeof values.averageWatchTimeSeconds === "number") {
      const weight = Math.max(1, values.views ?? 1);
      this.averageSum += values.averageWatchTimeSeconds * weight;
      this.averageWeight += weight;
    }
  }

  totals(): MetricTotals {
    const metrics = { ...this.metrics };
    if (this.averageWeight > 0) metrics.averageWatchTimeSeconds = round(this.averageSum / this.averageWeight, 1);
    return {
      metrics,
      engagements: this.engagements,
      engagementRate: this.rateDenominator > 0 ? round(this.rateNumerator / this.rateDenominator, 4) : null,
    };
  }
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function rowColumns(row: RowLike): ColumnValues {
  const values: ColumnValues = {};
  for (const column of SNAPSHOT_COLUMNS) values[column] = row[column];
  return values;
}

function hasData(row: RowLike): boolean {
  return row.fetchedAt !== null && SNAPSHOT_COLUMNS.some((column) => row[column] !== null);
}

export function sortValue(totals: MetricTotals, key: SortableMetric, publishedAt?: Date): number {
  if (key === "publishedAt") return publishedAt?.getTime() ?? 0;
  if (key === "engagements") return totals.engagements ?? -1;
  if (key === "engagementRate") return totals.engagementRate ?? -1;
  return totals.metrics[key] ?? -1;
}

function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (typeof current !== "number" || typeof previous !== "number") return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return round((current - previous) / previous, 4);
}

export function compareTotals(current: MetricTotals, previous: MetricTotals): Record<string, number | null> {
  const change: Record<string, number | null> = {};
  for (const metric of POST_METRICS) change[metric] = percentChange(current.metrics[metric], previous.metrics[metric]);
  change.engagements = percentChange(current.engagements, previous.engagements);
  change.engagementRate =
    current.engagementRate !== null && previous.engagementRate !== null
      ? round(current.engagementRate - previous.engagementRate, 4)
      : null;
  return change;
}

/* ------------------------------------------------------------------------ */
/* Accounts                                                                  */
/* ------------------------------------------------------------------------ */

export interface AnalyticsAccountInfo {
  accountId: string;
  platform: Platform;
  username: string | null;
  displayName: string | null;
  profilePicture: string | null;
  /** Whether SimplePost can read post analytics for this account. */
  postAnalytics: boolean;
  reconnectRecommended: boolean;
  missingScopes: string[];
  notice: string | null;
  supportedMetrics: PostMetric[];
  supportedAccountMetrics: AccountMetric[];
}

export async function loadAnalyticsAccounts(
  userId: string,
  workspaceId: string | null = null,
): Promise<Map<string, AnalyticsAccountInfo>> {
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, workspaceId, platform: { notIn: PAUSED_ANALYTICS_PLATFORMS } },
    select: {
      id: true,
      platform: true,
      username: true,
      displayName: true,
      profilePicture: true,
      scope: true,
      tokenMetadata: true,
    },
  });
  return new Map(
    accounts.map((account) => {
      const platform = mapPlatformName(account.platform);
      let tokenMetadata: unknown = null;
      try {
        tokenMetadata = decryptTokenMetadata(account.tokenMetadata);
      } catch {
        tokenMetadata = null;
      }
      const readiness = analyticsAccountReadiness({ platform, scope: account.scope, tokenMetadata });
      const capability = getAnalyticsCapability(platform);
      const followerReadiness = accountAnalyticsReadiness({ platform, scope: account.scope });
      const needsFollowerGrant = followerReadiness.reconnectRecommended === true;
      return [
        account.id,
        {
          accountId: account.id,
          platform,
          username: account.username,
          displayName: account.displayName,
          profilePicture: account.profilePicture,
          postAnalytics: readiness.ready,
          reconnectRecommended: readiness.reconnectRecommended || needsFollowerGrant,
          missingScopes: readiness.missingScopes,
          notice:
            readiness.message ||
            (followerReadiness.reconnectRecommended === undefined ? null : (followerReadiness.message ?? null)),
          supportedMetrics: [...capability.postMetrics],
          supportedAccountMetrics: [...capability.accountMetrics],
        },
      ];
    }),
  );
}

/* ------------------------------------------------------------------------ */
/* Single post                                                               */
/* ------------------------------------------------------------------------ */

export interface PostAnalyticsAccountView extends MetricTotals {
  accountId: string;
  platform: Platform;
  username: string | null;
  displayName: string | null;
  platformPostId: string;
  postUrl: string | null;
  status: string;
  message: string | null;
  platformMetrics: Record<string, number>;
  supportedMetrics: PostMetric[];
  fetchedAt: string | null;
  nextRefreshAt: string | null;
  isStale: boolean;
  reconnectRecommended: boolean;
}

export interface PostAnalyticsView {
  postId: string;
  status: string;
  publishedAt: string | null;
  totals: MetricTotals;
  accounts: PostAnalyticsAccountView[];
  /** Combined metrics over time, from stored snapshots. */
  history: Array<{ at: string } & MetricTotals>;
  lastUpdatedAt: string | null;
  isStale: boolean;
  /** True when the post has no published accounts yet (draft, scheduled, failed everywhere). */
  notPublished: boolean;
}

export async function getPostAnalyticsView(userId: string, postId: string): Promise<PostAnalyticsView | null> {
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      userId,
      OR: [{ workspaceReviewId: null }, { accounts: { some: { userId, workspaceId: null } } }],
    },
    select: { id: true, status: true, publishedAt: true, accountResults: true },
  });
  if (!post) return null;

  const [rows, accounts] = await Promise.all([
    prisma.postAnalytics.findMany({
      where: {
        postId,
        userId,
        account: { userId, workspaceId: null },
        platform: { notIn: PAUSED_ANALYTICS_PLATFORMS },
      },
      select: { ...ROW_SELECT, platformMetrics: true, account: { select: { updatedAt: true } } },
      orderBy: { platform: "asc" },
    }),
    loadAnalyticsAccounts(userId),
  ]);
  const results = (post.accountResults as AccountResultsMap | null) ?? {};
  const now = new Date();

  const accountViews = rows.map((row): PostAnalyticsAccountView => {
    const account = accounts.get(row.accountId);
    const accumulator = new Accumulator();
    accumulator.add(rowColumns(row));
    const totals = accumulator.totals();
    return {
      ...totals,
      metrics: metricsFromColumns(row),
      accountId: row.accountId,
      platform: mapPlatformName(row.platform),
      username: account?.username ?? null,
      displayName: account?.displayName ?? null,
      platformPostId: row.platformPostId,
      postUrl: results[row.accountId]?.postUrl ?? null,
      status: row.status,
      message: row.message ?? (row.status === "ok" ? account?.notice || null : null),
      platformMetrics: (row.platformMetrics as Record<string, number> | null) ?? {},
      supportedMetrics: [...getAnalyticsCapability(mapPlatformName(row.platform)).postMetrics],
      fetchedAt: row.fetchedAt?.toISOString() ?? null,
      nextRefreshAt: row.status === "unsupported" ? null : row.nextRefreshAt.toISOString(),
      isStale: row.status !== "unsupported" && isStale(row, row.account, now),
      reconnectRecommended: account?.reconnectRecommended ?? false,
    };
  });

  const total = new Accumulator();
  for (const row of rows) if (row.status === "ok" || hasData(row)) total.add(rowColumns(row));
  const fetched = rows.map((row) => row.fetchedAt?.getTime() ?? 0).filter(Boolean);

  return {
    postId: post.id,
    status: post.status,
    publishedAt: post.publishedAt?.toISOString() ?? rows[0]?.publishedAt.toISOString() ?? null,
    totals: total.totals(),
    accounts: accountViews,
    history: await postHistory(rows.map((row) => row.id)),
    lastUpdatedAt: fetched.length > 0 ? new Date(Math.max(...fetched)).toISOString() : null,
    isStale: accountViews.some((view) => view.isStale),
    notPublished: rows.length === 0,
  };
}

/** Sums each account's latest snapshot at every capture time (carrying values forward). */
async function postHistory(rowIds: string[]): Promise<Array<{ at: string } & MetricTotals>> {
  if (rowIds.length === 0) return [];
  const snapshots = await prisma.postAnalyticsSnapshot.findMany({
    where: { analyticsId: { in: rowIds } },
    orderBy: { capturedAt: "asc" },
    take: 2000,
  });
  const latest = new Map<string, ColumnValues>();
  const points: Array<{ at: string } & MetricTotals> = [];
  for (const snapshot of snapshots) {
    latest.set(snapshot.analyticsId, snapshot);
    const accumulator = new Accumulator();
    for (const values of latest.values()) accumulator.add(values);
    const point = { at: snapshot.capturedAt.toISOString(), ...accumulator.totals() };
    // Several accounts refreshed together produce one point.
    if (points.at(-1) && Date.parse(points.at(-1)!.at) > snapshot.capturedAt.getTime() - 60_000) points.pop();
    points.push(point);
  }
  return points;
}

async function earliestPublishedAt(userId: string, workspaceId?: string | null): Promise<Date | null> {
  const first = await prisma.postAnalytics.findFirst({
    where: {
      userId,
      account: { workspaceId: workspaceId ?? null },
    },
    orderBy: { publishedAt: "asc" },
    select: { publishedAt: true },
  });
  return first?.publishedAt ?? null;
}

/* ------------------------------------------------------------------------ */
/* Summaries                                                                 */
/* ------------------------------------------------------------------------ */

export interface SummaryFilters {
  workspaceId?: string | null;
  period?: AnalyticsPeriod;
  from?: string;
  to?: string;
  timeZone?: string;
  granularity?: AnalyticsGranularity;
  platforms?: string[];
  accountIds?: string[];
  /** published: lifetime metrics of posts published in the period. activity: metrics gained during the period. */
  mode?: SummaryMode;
  compare?: boolean;
  topLimit?: number;
  topSortBy?: SortableMetric;
}

export interface PostSummaryItem extends MetricTotals {
  postId: string;
  teamPostId?: string;
  teamWorkspaceId?: string;
  message: string;
  publishedAt: string;
  platforms: Platform[];
  accounts: Array<{
    accountId: string;
    platform: Platform;
    username: string | null;
    postUrl: string | null;
    status: string;
  }>;
  thumbnailUrl: string | null;
  mediaType: "image" | "video" | null;
}

export interface AnalyticsSummary {
  period: {
    key: AnalyticsPeriod;
    start: string;
    end: string;
    timeZone: string;
    granularity: AnalyticsGranularity;
    previous: { start: string; end: string } | null;
  };
  mode: SummaryMode;
  filters: { platforms: string[]; accountIds: string[] };
  totals: MetricTotals & { posts: number; publications: number };
  previous: (MetricTotals & { posts: number; publications: number }) | null;
  change: Record<string, number | null> | null;
  byPlatform: Array<
    MetricTotals & {
      platform: Platform;
      posts: number;
      accounts: number;
      supportedMetrics: PostMetric[];
      share: number | null;
    }
  >;
  byAccount: Array<
    MetricTotals & {
      accountId: string;
      platform: Platform;
      username: string | null;
      displayName: string | null;
      profilePicture: string | null;
      posts: number;
      followers: number | null;
      followersChange: number | null;
    }
  >;
  timeline: Array<{ start: string; posts: number } & MetricTotals>;
  topPosts: PostSummaryItem[];
  platforms: Platform[];
  bestTimes: {
    bySlot: Array<{ weekday: number; hour: number; posts: number; averageEngagements: number | null }>;
    byWeekday: Array<{ weekday: number; posts: number; averageEngagements: number | null }>;
    byHour: Array<{ hour: number; posts: number; averageEngagements: number | null }>;
  };
  followers: Array<{
    accountId: string;
    platform: Platform;
    username: string | null;
    current: number | null;
    change: number | null;
    series: Array<{ day: string; followers: number }>;
    baseline?: { day: string; followers: number };
  }>;
  coverage: {
    publications: number;
    withData: number;
    pending: number;
    unavailable: number;
    stale: number;
    lastUpdatedAt: string | null;
  };
  notices: Array<{
    accountId: string;
    platform: Platform;
    username: string | null;
    message: string;
    reconnectRecommended: boolean;
  }>;
}

type SummaryRow = RowLike & { account: { updatedAt: Date } };

async function loadRows(
  userId: string,
  filters: Pick<SummaryFilters, "platforms" | "accountIds" | "workspaceId">,
  publishedRange: { gte?: Date; lt: Date },
): Promise<SummaryRow[]> {
  return prisma.postAnalytics.findMany({
    where: {
      userId,
      publishedAt: publishedRange,
      account: { workspaceId: filters.workspaceId ?? null },
      platform: {
        notIn: PAUSED_ANALYTICS_PLATFORMS,
        ...(filters.platforms?.length ? { in: filters.platforms.map((p) => mapPlatformName(p)) } : {}),
      },
      ...(filters.accountIds?.length ? { accountId: { in: filters.accountIds } } : {}),
    },
    select: { ...ROW_SELECT, account: { select: { updatedAt: true } } },
  });
}

/**
 * Metric values per row for the period. "published" uses each post's latest
 * lifetime values. "activity" uses the growth between snapshots captured
 * within the period (approximate: growth is attributed to when SimplePost
 * observed it), so it covers older posts that kept getting engagement.
 */
async function valuesForPeriod(
  rows: SummaryRow[],
  mode: SummaryMode,
  start: Date,
  end: Date,
  granularity: AnalyticsGranularity,
  timeZone: string,
): Promise<{ values: Map<string, ColumnValues>; buckets: Map<string, Map<number, ColumnValues>> }> {
  const values = new Map<string, ColumnValues>();
  const buckets = new Map<string, Map<number, ColumnValues>>();

  if (mode === "published") {
    for (const row of rows) {
      if (!hasData(row)) continue;
      const columns = rowColumns(row);
      values.set(row.id, columns);
      buckets.set(row.id, new Map([[bucketStart(row.publishedAt, granularity, timeZone).getTime(), columns]]));
    }
    return { values, buckets };
  }

  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return { values, buckets };
  const [baselines, snapshots] = await Promise.all([
    prisma.$queryRaw<Array<{ analyticsId: string } & ColumnValues>>`
      SELECT DISTINCT ON ("analyticsId") "analyticsId", "views", "reach", "likes", "comments", "shares", "quotes",
        "saves", "clicks", "profileVisits", "follows", "watchTimeSeconds", "averageWatchTimeSeconds", "engagements"
      FROM "post_analytics_snapshot"
      WHERE "analyticsId" = ANY(${ids}) AND "capturedAt" < (${start.toISOString()}::timestamptz AT TIME ZONE 'UTC')
      ORDER BY "analyticsId", "capturedAt" DESC`,
    prisma.postAnalyticsSnapshot.findMany({
      where: { analyticsId: { in: ids }, capturedAt: { gte: start, lt: end } },
      orderBy: { capturedAt: "asc" },
    }),
  ]);
  const baselineById = new Map(baselines.map((baseline) => [baseline.analyticsId, baseline as ColumnValues]));
  const publishedById = new Map(rows.map((row) => [row.id, row.publishedAt]));
  const previous = new Map<string, ColumnValues>();

  for (const snapshot of snapshots) {
    const id = snapshot.analyticsId;
    let before = previous.get(id) ?? baselineById.get(id);
    if (!before) {
      // Posts published inside the period start from zero; for older posts
      // without an earlier snapshot the first observation is the baseline.
      if ((publishedById.get(id)?.getTime() ?? 0) >= start.getTime()) before = {};
      else {
        previous.set(id, snapshot);
        continue;
      }
    }
    const delta: ColumnValues = {};
    for (const column of SNAPSHOT_COLUMNS) {
      if (column === "averageWatchTimeSeconds") continue;
      const after = snapshot[column];
      if (typeof after !== "number") continue;
      const prior = typeof before[column] === "number" ? (before[column] as number) : 0;
      delta[column] = Math.max(0, after - prior);
    }
    previous.set(id, snapshot);

    const total = values.get(id) ?? {};
    for (const [column, value] of Object.entries(delta) as Array<[SnapshotColumn, number]>)
      total[column] = (total[column] ?? 0) + value;
    values.set(id, total);

    const key = bucketStart(snapshot.capturedAt, granularity, timeZone).getTime();
    const rowBuckets = buckets.get(id) ?? new Map<number, ColumnValues>();
    const bucket = rowBuckets.get(key) ?? {};
    for (const [column, value] of Object.entries(delta) as Array<[SnapshotColumn, number]>)
      bucket[column] = (bucket[column] ?? 0) + value;
    rowBuckets.set(key, bucket);
    buckets.set(id, rowBuckets);
  }
  return { values, buckets };
}

async function totalsForPeriod(
  userId: string,
  filters: SummaryFilters,
  mode: SummaryMode,
  start: Date,
  end: Date,
): Promise<MetricTotals & { posts: number; publications: number }> {
  const rows = await loadRows(userId, filters, mode === "published" ? { gte: start, lt: end } : { lt: end });
  const { values } = await valuesForPeriod(rows, mode, start, end, "day", "UTC");
  const accumulator = new Accumulator();
  const posts = new Set<string>();
  for (const row of rows) {
    const columns = values.get(row.id);
    if (!columns) continue;
    accumulator.add(columns);
    posts.add(row.postId);
  }
  return {
    ...accumulator.totals(),
    posts: mode === "published" ? new Set(rows.map((row) => row.postId)).size : posts.size,
    publications: mode === "published" ? rows.length : values.size,
  };
}

export async function getAnalyticsSummary(userId: string, filters: SummaryFilters = {}): Promise<AnalyticsSummary> {
  const mode = filters.mode ?? "published";
  const earliest = filters.period === "all_time" ? await earliestPublishedAt(userId, filters.workspaceId) : null;
  const period: ResolvedPeriod = resolvePeriod({
    period: filters.period,
    from: filters.from,
    to: filters.to,
    timeZone: filters.timeZone,
    granularity: filters.granularity,
    earliest,
  });
  const { start, end, granularity, timeZone } = period;

  const [rows, accounts] = await Promise.all([
    loadRows(userId, filters, mode === "published" ? { gte: start, lt: end } : { lt: end }),
    loadAnalyticsAccounts(userId, filters.workspaceId),
  ]);
  const { values, buckets } = await valuesForPeriod(rows, mode, start, end, granularity, timeZone);
  const included = rows.filter((row) => values.has(row.id));
  const now = new Date();

  // Totals
  const total = new Accumulator();
  for (const row of included) total.add(values.get(row.id)!);
  const publishedRows = mode === "published" ? rows : included;
  const totals = {
    ...total.totals(),
    posts: new Set(publishedRows.map((row) => row.postId)).size,
    publications: publishedRows.length,
  };

  // Comparison
  let previous: AnalyticsSummary["previous"] = null;
  let change: AnalyticsSummary["change"] = null;
  if (filters.compare !== false && period.previous) {
    previous = await totalsForPeriod(userId, filters, mode, period.previous.start, period.previous.end);
    change = compareTotals(totals, previous);
    change.posts = percentChange(totals.posts, previous.posts);
  }

  // By platform
  const platformGroups = new Map<Platform, { accumulator: Accumulator; posts: Set<string>; accounts: Set<string> }>();
  for (const row of publishedRows) {
    const platform = mapPlatformName(row.platform);
    const group = platformGroups.get(platform) ?? {
      accumulator: new Accumulator(),
      posts: new Set(),
      accounts: new Set(),
    };
    const columns = values.get(row.id);
    if (columns) group.accumulator.add(columns);
    group.posts.add(row.postId);
    group.accounts.add(row.accountId);
    platformGroups.set(platform, group);
  }
  const totalEngagements = totals.engagements ?? 0;
  const byPlatform = [...platformGroups.entries()]
    .map(([platform, group]) => {
      const groupTotals = group.accumulator.totals();
      return {
        platform,
        ...groupTotals,
        posts: group.posts.size,
        accounts: group.accounts.size,
        supportedMetrics: [...getAnalyticsCapability(platform).postMetrics],
        share:
          totalEngagements > 0 && groupTotals.engagements !== null
            ? round(groupTotals.engagements / totalEngagements, 4)
            : null,
      };
    })
    .sort((a, b) => (b.engagements ?? -1) - (a.engagements ?? -1) || b.posts - a.posts);

  // Followers (daily account snapshots)
  const followers = await followerSeries(userId, filters, start, end, accounts);
  const followersByAccount = new Map(followers.map((entry) => [entry.accountId, entry]));

  // By account
  const accountGroups = new Map<string, { accumulator: Accumulator; posts: Set<string> }>();
  for (const row of publishedRows) {
    const group = accountGroups.get(row.accountId) ?? { accumulator: new Accumulator(), posts: new Set() };
    const columns = values.get(row.id);
    if (columns) group.accumulator.add(columns);
    group.posts.add(row.postId);
    accountGroups.set(row.accountId, group);
  }
  for (const account of accounts.values()) {
    if (filters.accountIds?.length && !filters.accountIds.includes(account.accountId)) continue;
    if (
      filters.platforms?.length &&
      !filters.platforms.map((platform) => mapPlatformName(platform)).includes(account.platform)
    )
      continue;
    if (!accountGroups.has(account.accountId))
      accountGroups.set(account.accountId, { accumulator: new Accumulator(), posts: new Set() });
  }
  const byAccount = [...accountGroups.entries()]
    .flatMap(([accountId, group]) => {
      const account = accounts.get(accountId);
      if (!account) return [];
      const follower = followersByAccount.get(accountId);
      return [
        {
          accountId,
          platform: account.platform,
          username: account.username,
          displayName: account.displayName,
          profilePicture: account.profilePicture,
          ...group.accumulator.totals(),
          posts: group.posts.size,
          followers: follower?.current ?? null,
          followersChange: follower?.change ?? null,
        },
      ];
    })
    .sort((a, b) => (b.engagements ?? -1) - (a.engagements ?? -1) || b.posts - a.posts);

  // Timeline
  const bucketKeys = bucketStarts(start, end, granularity, timeZone);
  const timelineMap = new Map(
    bucketKeys.map((key) => [key.getTime(), { accumulator: new Accumulator(), posts: new Set<string>() }]),
  );
  for (const row of included) {
    for (const [key, columns] of buckets.get(row.id) ?? []) {
      const bucket = timelineMap.get(key);
      if (!bucket) continue;
      bucket.accumulator.add(columns);
      // Activity counts the posts that gained anything in the bucket.
      if (mode === "published" || Object.values(columns).some((value) => typeof value === "number" && value > 0))
        bucket.posts.add(row.postId);
    }
  }
  if (mode === "published") {
    // Posts without data yet still count as published in their bucket.
    for (const row of rows)
      timelineMap.get(bucketStart(row.publishedAt, granularity, timeZone).getTime())?.posts.add(row.postId);
  }
  const timeline = bucketKeys.map((key) => {
    const bucket = timelineMap.get(key.getTime())!;
    return { start: key.toISOString(), posts: bucket.posts.size, ...bucket.accumulator.totals() };
  });

  // Top posts
  const topPosts =
    filters.topLimit === 0
      ? []
      : await summarizePosts(userId, included, values, accounts, {
          sortBy: filters.topSortBy ?? "engagements",
          limit: filters.topLimit ?? 10,
        });

  // Best times (by local publish weekday/hour; always lifetime values of posts published in the period)
  const bestTimes = bestPublishingTimes(
    mode === "published" ? included : rows.filter((row) => row.publishedAt >= start && hasData(row)),
    mode === "published" ? values : new Map(rows.map((row) => [row.id, rowColumns(row)])),
    timeZone,
  );

  // Coverage + notices
  const pending = publishedRows.filter((row) => row.status === "pending").length;
  const unavailable = publishedRows.filter((row) => !["ok", "pending"].includes(row.status) && !hasData(row)).length;
  const fetchedTimes = publishedRows.map((row) => row.fetchedAt?.getTime() ?? 0).filter(Boolean);
  const coverage = {
    publications: publishedRows.length,
    withData: publishedRows.filter((row) => hasData(row)).length,
    pending,
    unavailable,
    stale: publishedRows.filter((row) => row.status !== "unsupported" && isStale(row, row.account, now)).length,
    lastUpdatedAt: fetchedTimes.length > 0 ? new Date(Math.max(...fetchedTimes)).toISOString() : null,
  };

  const notices: AnalyticsSummary["notices"] = [];
  for (const account of accounts.values()) {
    if (filters.accountIds?.length && !filters.accountIds.includes(account.accountId)) continue;
    if (filters.platforms?.length && !filters.platforms.map((p) => mapPlatformName(p)).includes(account.platform))
      continue;
    const failing = publishedRows.find(
      (row) => row.accountId === account.accountId && ["missing_permission", "credentials_error"].includes(row.status),
    );
    const message = failing?.message ?? account.notice;
    if (message && (account.reconnectRecommended || failing || !account.postAnalytics))
      notices.push({
        accountId: account.accountId,
        platform: account.platform,
        username: account.username,
        message,
        reconnectRecommended:
          account.reconnectRecommended ||
          failing?.status === "missing_permission" ||
          failing?.status === "credentials_error",
      });
  }

  return {
    period: {
      key: period.period,
      start: start.toISOString(),
      end: end.toISOString(),
      timeZone,
      granularity,
      previous: period.previous
        ? { start: period.previous.start.toISOString(), end: period.previous.end.toISOString() }
        : null,
    },
    mode,
    filters: { platforms: filters.platforms ?? [], accountIds: filters.accountIds ?? [] },
    totals,
    previous,
    change,
    byPlatform,
    byAccount,
    timeline,
    topPosts,
    platforms: [...new Set([...accounts.values()].map((account) => account.platform))].sort(),
    bestTimes,
    followers,
    coverage,
    notices,
  };
}

function bestPublishingTimes(
  rows: SummaryRow[],
  values: Map<string, ColumnValues>,
  timeZone: string,
): AnalyticsSummary["bestTimes"] {
  // Group by post first so cross-posting to many accounts doesn't count a post several times.
  const posts = new Map<string, { publishedAt: Date; engagements: number | null }>();
  for (const row of rows) {
    const engagements = values.get(row.id)?.engagements;
    const entry = posts.get(row.postId) ?? { publishedAt: row.publishedAt, engagements: null };
    if (typeof engagements === "number") entry.engagements = (entry.engagements ?? 0) + engagements;
    posts.set(row.postId, entry);
  }
  const weekdays = Array.from({ length: 7 }, (_, weekday) => ({ weekday, posts: 0, sum: 0, measured: 0 }));
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, posts: 0, sum: 0, measured: 0 }));
  const slots = weekdays.flatMap(({ weekday }) =>
    hours.map(({ hour }) => ({ weekday, hour, posts: 0, sum: 0, measured: 0 })),
  );
  for (const post of posts.values()) {
    const { weekday, hour } = localWeekdayHour(post.publishedAt, timeZone);
    for (const bucket of [weekdays[weekday], hours[hour], slots[weekday * 24 + hour]]) {
      bucket.posts += 1;
      if (post.engagements !== null) {
        bucket.sum += post.engagements;
        bucket.measured += 1;
      }
    }
  }
  const average = (bucket: { sum: number; measured: number }) =>
    bucket.measured > 0 ? round(bucket.sum / bucket.measured, 1) : null;
  return {
    bySlot: slots.map(({ weekday, hour, measured, sum }) => ({
      weekday,
      hour,
      posts: measured,
      averageEngagements: average({ sum, measured }),
    })),
    byWeekday: weekdays.map((bucket) => ({
      weekday: bucket.weekday,
      posts: bucket.posts,
      averageEngagements: average(bucket),
    })),
    byHour: hours.map((bucket) => ({ hour: bucket.hour, posts: bucket.posts, averageEngagements: average(bucket) })),
  };
}

async function followerSeries(
  userId: string,
  filters: SummaryFilters,
  start: Date,
  end: Date,
  accounts: Map<string, AnalyticsAccountInfo>,
): Promise<AnalyticsSummary["followers"]> {
  const platformFilter = filters.platforms?.length ? filters.platforms.map((p) => mapPlatformName(p)) : null;
  const accountIds = [...accounts.values()]
    .filter((account) => !filters.accountIds?.length || filters.accountIds.includes(account.accountId))
    .filter((account) => !platformFilter || platformFilter.includes(account.platform))
    .map((account) => account.accountId);
  if (accountIds.length === 0) return [];

  // `day` is a DATE column: compare whole UTC days (a timestamp bound would be truncated to its date).
  const dayStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const lastDay = new Date(end.getTime() - 1);
  const dayEnd = new Date(Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate() + 1));
  const [inRange, before] = await Promise.all([
    prisma.accountAnalyticsSnapshot.findMany({
      where: { userId, accountId: { in: accountIds }, day: { gte: dayStart, lt: dayEnd }, followers: { not: null } },
      orderBy: { day: "asc" },
      select: { accountId: true, day: true, followers: true },
    }),
    prisma.accountAnalyticsSnapshot.findMany({
      where: { userId, accountId: { in: accountIds }, day: { lt: dayStart }, followers: { not: null } },
      orderBy: { day: "desc" },
      distinct: ["accountId"],
      select: { accountId: true, day: true, followers: true },
    }),
  ]);
  const baseline = new Map(before.map((entry) => [entry.accountId, entry]));

  return accountIds.flatMap((accountId) => {
    const series = inRange
      .filter((entry) => entry.accountId === accountId)
      .map((entry) => ({ day: entry.day.toISOString().slice(0, 10), followers: entry.followers! }));
    const account = accounts.get(accountId)!;
    if (series.length === 0 && !baseline.has(accountId)) return [];
    const prior = baseline.get(accountId)?.followers ?? null;
    const current = series.at(-1)?.followers ?? prior;
    const first = prior ?? (series.length > 1 ? series[0].followers : null);
    const beforeRange = baseline.get(accountId);
    return [
      {
        accountId,
        platform: account.platform,
        username: account.username,
        current,
        change: current !== null && first !== null && series.length > 0 ? current - first : null,
        series,
        ...(beforeRange &&
          prior !== null && { baseline: { day: beforeRange.day.toISOString().slice(0, 10), followers: prior } }),
      },
    ];
  });
}

/* ------------------------------------------------------------------------ */
/* Post lists                                                                */
/* ------------------------------------------------------------------------ */

async function summarizePosts(
  userId: string,
  rows: SummaryRow[],
  values: Map<string, ColumnValues>,
  accounts: Map<string, AnalyticsAccountInfo>,
  options: { sortBy: SortableMetric; limit: number; offset?: number; order?: "asc" | "desc" },
): Promise<PostSummaryItem[]> {
  const grouped = new Map<string, { rows: SummaryRow[]; accumulator: Accumulator; publishedAt: Date }>();
  for (const row of rows) {
    const group = grouped.get(row.postId) ?? { rows: [], accumulator: new Accumulator(), publishedAt: row.publishedAt };
    group.rows.push(row);
    const columns = values.get(row.id);
    if (columns) group.accumulator.add(columns);
    if (row.publishedAt < group.publishedAt) group.publishedAt = row.publishedAt;
    grouped.set(row.postId, group);
  }
  const direction = options.order === "asc" ? 1 : -1;
  const ranked = [...grouped.entries()]
    .map(([postId, group]) => ({ postId, group, totals: group.accumulator.totals() }))
    .sort(
      (a, b) =>
        direction *
          (sortValue(a.totals, options.sortBy, a.group.publishedAt) -
            sortValue(b.totals, options.sortBy, b.group.publishedAt)) ||
        b.group.publishedAt.getTime() - a.group.publishedAt.getTime() ||
        a.postId.localeCompare(b.postId),
    )
    .slice(options.offset ?? 0, (options.offset ?? 0) + options.limit);
  if (ranked.length === 0) return [];

  const posts = await prisma.post.findMany({
    where: { userId, id: { in: ranked.map((entry) => entry.postId) } },
    select: {
      id: true,
      message: true,
      workspaceReview: { select: { postId: true, post: { select: { workspaceId: true } } } },
      accountResults: true,
      media: { select: { type: true, url: true, thumbnailUrl: true }, take: 1, orderBy: { createdAt: "asc" } },
    },
  });
  const postsById = new Map(posts.map((post) => [post.id, post]));

  return ranked.map(({ postId, group, totals }) => {
    const post = postsById.get(postId);
    const results = (post?.accountResults as AccountResultsMap | null) ?? {};
    const media = post?.media[0];
    return {
      postId,
      ...(post?.workspaceReview && {
        teamPostId: post.workspaceReview.postId,
        teamWorkspaceId: post.workspaceReview.post.workspaceId,
      }),
      message: post?.message ?? "",
      publishedAt: group.publishedAt.toISOString(),
      platforms: [...new Set(group.rows.map((row) => mapPlatformName(row.platform)))],
      accounts: group.rows.map((row) => ({
        accountId: row.accountId,
        platform: mapPlatformName(row.platform),
        username: accounts.get(row.accountId)?.username ?? null,
        postUrl: results[row.accountId]?.postUrl ?? null,
        status: row.status,
      })),
      thumbnailUrl: media ? (media.thumbnailUrl ?? (media.type === "image" ? media.url : null)) : null,
      mediaType: media ? (media.type === "video" ? "video" : "image") : null,
      ...totals,
    };
  });
}

export interface PostListFilters extends SummaryFilters {
  sortBy?: SortableMetric;
  order?: "asc" | "desc";
  page?: number;
  limit?: number;
}

/** Paginated, sortable list of posts with their analytics for a period. */
export async function listPostAnalytics(
  userId: string,
  filters: PostListFilters = {},
): Promise<{
  period: AnalyticsSummary["period"];
  mode: SummaryMode;
  posts: PostSummaryItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const mode = filters.mode ?? "published";
  const earliest = filters.period === "all_time" ? await earliestPublishedAt(userId, filters.workspaceId) : null;
  const period = resolvePeriod({ ...filters, earliest });
  const rows = await loadRows(
    userId,
    filters,
    mode === "published" ? { gte: period.start, lt: period.end } : { lt: period.end },
  );
  const { values } = await valuesForPeriod(rows, mode, period.start, period.end, "day", period.timeZone);
  const included = mode === "published" ? rows : rows.filter((row) => values.has(row.id));
  const accounts = await loadAnalyticsAccounts(userId, filters.workspaceId);
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const total = new Set(included.map((row) => row.postId)).size;
  const posts = await summarizePosts(userId, included, values, accounts, {
    sortBy: filters.sortBy ?? (mode === "published" ? "publishedAt" : "engagements"),
    order: filters.order ?? "desc",
    limit,
    offset: (page - 1) * limit,
  });
  return {
    period: {
      key: period.period,
      start: period.start.toISOString(),
      end: period.end.toISOString(),
      timeZone: period.timeZone,
      granularity: period.granularity,
      previous: period.previous
        ? { start: period.previous.start.toISOString(), end: period.previous.end.toISOString() }
        : null,
    },
    mode,
    posts,
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}

/* ------------------------------------------------------------------------ */
/* Accounts overview                                                         */
/* ------------------------------------------------------------------------ */

export interface AccountAnalyticsOverview {
  accountId: string;
  platform: Platform;
  username: string | null;
  displayName: string | null;
  profilePicture: string | null;
  status: string | null;
  message: string | null;
  metrics: Partial<Record<AccountMetric, number>>;
  capturedAt: string | null;
  postAnalytics: boolean;
  accountAnalytics: boolean;
  reconnectRecommended: boolean;
  notice: string | null;
  supportedMetrics: PostMetric[];
  supportedAccountMetrics: AccountMetric[];
}

/** Latest account-level analytics (followers, …) for each connected account. */
export async function getAccountsAnalytics(userId: string): Promise<AccountAnalyticsOverview[]> {
  const [accounts, scopes, latest] = await Promise.all([
    loadAnalyticsAccounts(userId),
    prisma.connectedAccount.findMany({ where: { userId }, select: { id: true, platform: true, scope: true } }),
    prisma.accountAnalyticsSnapshot.findMany({
      where: { userId },
      orderBy: { capturedAt: "desc" },
      distinct: ["accountId"],
    }),
  ]);
  // A failed read must not hide the numbers captured earlier: fall back to the latest ok snapshot.
  const lastOk = await prisma.accountAnalyticsSnapshot.findMany({
    where: {
      userId,
      status: "ok",
      accountId: { in: latest.filter((entry) => entry.status !== "ok").map((entry) => entry.accountId) },
    },
    orderBy: { capturedAt: "desc" },
    distinct: ["accountId"],
  });
  const lastOkByAccount = new Map(lastOk.map((entry) => [entry.accountId, entry]));
  const latestByAccount = new Map(latest.map((entry) => [entry.accountId, entry]));
  const scopeByAccount = new Map(scopes.map((entry) => [entry.id, entry]));
  return [...accounts.values()].map((account) => {
    const snapshot = latestByAccount.get(account.accountId);
    const values = snapshot?.status === "ok" ? snapshot : (lastOkByAccount.get(account.accountId) ?? snapshot);
    const metrics: Partial<Record<AccountMetric, number>> = {};
    for (const metric of ["followers", "following", "posts", "totalViews", "totalLikes"] as const) {
      const value = values?.[metric];
      if (typeof value === "number") metrics[metric] = value;
    }
    const accountReadiness = accountAnalyticsReadiness({
      platform: account.platform,
      scope: scopeByAccount.get(account.accountId)?.scope ?? null,
    });
    return {
      accountId: account.accountId,
      platform: account.platform,
      username: account.username,
      displayName: account.displayName,
      profilePicture: account.profilePicture,
      status: snapshot?.status ?? null,
      message: snapshot?.message ?? accountReadiness.message ?? null,
      metrics,
      capturedAt: snapshot?.capturedAt.toISOString() ?? null,
      postAnalytics: account.postAnalytics,
      accountAnalytics: accountReadiness.ready,
      reconnectRecommended: account.reconnectRecommended,
      notice: account.notice,
      supportedMetrics: account.supportedMetrics,
      supportedAccountMetrics: account.supportedAccountMetrics,
    };
  });
}
