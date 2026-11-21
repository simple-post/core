import { createLogger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { backgroundRefreshEnabled, backgroundRefreshPlatforms } from "./config";
import { ensureAnalyticsRows, refreshAccountAnalytics, refreshPostAnalytics, type RefreshOutcome } from "./service";

const log = createLogger("post-analytics:background");

/** Posts older than this are only refreshed on demand. */
const SEED_WINDOW_MS = 90 * 24 * 60 * 60_000;

export interface BackgroundAnalyticsResult {
  skipped: boolean;
  seededPosts: number;
  posts: RefreshOutcome;
  accounts: number;
}

/**
 * Keeps analytics of recent posts fresh between visits. Runs after the
 * scheduled-post dispatcher with a small time budget so it never delays
 * publishing; anything left over is picked up by the next run.
 */
export async function runBackgroundAnalyticsRefresh(
  options: { budgetMs?: number } = {},
): Promise<BackgroundAnalyticsResult> {
  const empty = { refreshed: 0, succeeded: 0, failed: 0, skipped: 0 };
  if (!backgroundRefreshEnabled()) return { skipped: true, seededPosts: 0, posts: empty, accounts: 0 };

  const since = new Date(Date.now() - SEED_WINDOW_MS);
  let seededPosts = 0;
  try {
    const posts = await prisma.post.findMany({
      where: {
        status: "published",
        publishedAt: { gte: since },
        // Recently updated posts may have published to more accounts on a retry.
        OR: [{ analytics: { none: {} } }, { updatedAt: { gte: new Date(Date.now() - 2 * 24 * 60 * 60_000) } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        userId: true,
        status: true,
        publishedAt: true,
        updatedAt: true,
        accountResults: true,
        accounts: { select: { id: true, platform: true } },
      },
      take: 200,
    });
    await ensureAnalyticsRows(posts);
    seededPosts = posts.length;
  } catch (error) {
    log.warn({ err: serializeError(error) }, "Could not seed post analytics rows");
  }

  const posts = await refreshPostAnalytics({
    limit: 100,
    budgetMs: options.budgetMs ?? 20_000,
    reason: "background",
    platforms: backgroundRefreshPlatforms(),
  });
  const { refreshed: accounts } = await refreshAccountAnalytics({ limit: 20, reason: "background" });
  return { skipped: false, seededPosts, posts, accounts };
}
