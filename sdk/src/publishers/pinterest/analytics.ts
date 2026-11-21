import { AnalyticsError, numericFields, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";
import { httpStatus } from "../../utils/transient-retry";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics, PostMetrics } from "../../analytics";
import type { AxiosInstance } from "axios";

const REQUEST_TIMEOUT_MS = 15_000;

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** Pinterest returns lowercase counters on `pin_metrics` (lifetime and 90-day). */
export function mapPinMetrics(pinMetrics: Record<string, unknown> | undefined): PostMetrics {
  const lifetime = object(pinMetrics?.lifetime_metrics) ?? {};
  const recent = object(pinMetrics?.["90d"]) ?? {};
  const read = (name: string) => toFiniteNumber(lifetime[name]) ?? toFiniteNumber(recent[name]);
  const metrics: PostMetrics = {};
  const impressions = read("impression");
  const pinClicks = read("pin_click");
  const outboundClicks = read("clickthrough") ?? read("outbound_click");
  const saves = read("save");
  const reactions = read("reaction");
  const comments = read("comment");
  if (impressions !== undefined) metrics.views = impressions;
  if (pinClicks !== undefined || outboundClicks !== undefined)
    metrics.clicks = (pinClicks ?? 0) + (outboundClicks ?? 0);
  if (saves !== undefined) metrics.saves = saves;
  if (reactions !== undefined) metrics.likes = reactions;
  if (comments !== undefined) metrics.comments = comments;
  return metrics;
}

function rethrow(error: unknown): never {
  const body = (error as { response?: { data?: { code?: unknown; message?: unknown } } })?.response?.data;
  const message = typeof body?.message === "string" ? body.message : "";
  if (httpStatus(error) === 403 && /PINNER_DATA_ACCESS_DENIED/i.test(`${message} ${String(body?.code ?? "")}`)) {
    throw new AnalyticsError(
      "missing_permission",
      "Pinterest only shares analytics for business accounts with this app. Convert the Pinterest account to a free business account and reconnect it.",
    );
  }
  throw error;
}

export async function fetchPinterestPostAnalytics(
  client: AxiosInstance,
  targets: AnalyticsTarget[],
): Promise<PostAnalytics[]> {
  const results: PostAnalytics[] = [];
  for (const target of targets) {
    try {
      const response = await client.get<Record<string, unknown>>(`/pins/${encodeURIComponent(target.postId)}`, {
        params: { pin_metrics: true },
        timeout: REQUEST_TIMEOUT_MS,
      });
      const pin = response.data ?? {};
      const pinMetrics = object(pin.pin_metrics);
      results.push(
        postAnalyticsResult("pinterest", target.postId, "ok", {
          metrics: mapPinMetrics(pinMetrics),
          platformMetrics: {
            ...numericFields(object(pinMetrics?.lifetime_metrics), "lifetime."),
            ...numericFields(object(pinMetrics?.["90d"]), "90d."),
          },
          url: `https://www.pinterest.com/pin/${target.postId}/`,
          publishedAt: typeof pin.created_at === "string" ? pin.created_at : undefined,
        }),
      );
    } catch (error) {
      if (httpStatus(error) === 404) {
        results.push(
          postAnalyticsResult("pinterest", target.postId, "not_found", {
            message: "Pinterest could not find this pin. It may have been deleted.",
          }),
        );
        continue;
      }
      rethrow(error);
    }
  }
  return results;
}

export async function fetchPinterestAccountAnalytics(client: AxiosInstance): Promise<AccountAnalytics> {
  try {
    const response = await client.get<Record<string, unknown>>("/user_account", { timeout: REQUEST_TIMEOUT_MS });
    const account = response.data ?? {};
    const value = (name: string) => toFiniteNumber(account[name]);
    return {
      platform: "pinterest",
      status: "ok",
      metrics: {
        ...(value("follower_count") === undefined ? {} : { followers: value("follower_count") }),
        ...(value("following_count") === undefined ? {} : { following: value("following_count") }),
        ...(value("pin_count") === undefined ? {} : { posts: value("pin_count") }),
      },
      platformMetrics: numericFields(account),
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    rethrow(error);
  }
}
