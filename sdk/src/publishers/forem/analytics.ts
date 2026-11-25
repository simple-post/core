import axios from "axios";

import { foremSafeLookup, normalizeForemInstanceUrl } from "./security";

import { numericFields, pickMetrics, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics } from "../../analytics";

const PAGE_SIZE = 1000;
/** Safety cap: 10 pages = 10,000 articles. */
const MAX_PAGES = 10;

interface ForemArticle {
  id?: number;
  url?: string;
  published_at?: string | null;
  page_views_count?: number;
  public_reactions_count?: number;
  positive_reactions_count?: number;
  comments_count?: number;
  reading_time_minutes?: number;
  [key: string]: unknown;
}

function requestConfig(apiKey: string) {
  return {
    headers: { "api-key": apiKey, Accept: "application/vnd.forem.api-v1+json" },
    timeout: 20_000,
    maxRedirects: 0,
    lookup: foremSafeLookup,
  };
}

/**
 * Page views are only exposed to the author through /api/articles/me/*,
 * which lists every article with its counters, so one request covers up to
 * 1,000 articles.
 */
export async function fetchForemPostAnalytics(
  credentials: { instanceUrl: string; apiKey: string },
  targets: AnalyticsTarget[],
): Promise<PostAnalytics[]> {
  const instanceUrl = normalizeForemInstanceUrl(credentials.instanceUrl);
  const wanted = new Set(targets.map((target) => target.postId));
  const articles = new Map<string, ForemArticle>();

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = await axios.get<ForemArticle[]>(`${instanceUrl}/api/articles/me/all`, {
      ...requestConfig(credentials.apiKey),
      params: { per_page: PAGE_SIZE, page },
    });
    const batch = Array.isArray(response.data) ? response.data : [];
    for (const article of batch) {
      if (article.id !== undefined && wanted.has(String(article.id))) articles.set(String(article.id), article);
    }
    if (batch.length < PAGE_SIZE || articles.size === wanted.size) break;
  }

  return targets.map((target) => {
    const article = articles.get(target.postId);
    if (!article) {
      return postAnalyticsResult("forem", target.postId, "not_found", {
        message: "This article is no longer in your account. It may have been deleted.",
      });
    }
    const counters = article as Record<string, unknown>;
    const metrics = pickMetrics(counters, { page_views_count: "views", comments_count: "comments" });
    const likes = toFiniteNumber(article.public_reactions_count) ?? toFiniteNumber(article.positive_reactions_count);
    if (likes !== undefined) metrics.likes = likes;
    return postAnalyticsResult("forem", target.postId, "ok", {
      metrics,
      platformMetrics: numericFields(counters),
      url: typeof article.url === "string" ? article.url : undefined,
      publishedAt: article.published_at ?? undefined,
    });
  });
}

export async function fetchForemAccountAnalytics(credentials: {
  instanceUrl: string;
  apiKey: string;
}): Promise<AccountAnalytics> {
  const instanceUrl = normalizeForemInstanceUrl(credentials.instanceUrl);
  const response = await axios.get<Record<string, unknown>>(
    `${instanceUrl}/api/users/me`,
    requestConfig(credentials.apiKey),
  );
  const user = response.data ?? {};
  const followers = toFiniteNumber(user.followers_count);
  return {
    platform: "forem",
    status: "ok",
    metrics: followers === undefined ? {} : { followers },
    platformMetrics: numericFields(user),
    fetchedAt: new Date().toISOString(),
  };
}
