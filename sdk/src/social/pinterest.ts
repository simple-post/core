import { bearer, hasId, invalidRequest, invalidResponse, number, record, requestJson, resultMetrics } from "./shared";

import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialActivityResult,
  SocialPostMetrics,
} from "../types/social";

const PIN_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const MAX_RANGE_DAYS = 90;

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startDate(publishedAt: string | undefined, end: Date): string {
  const earliest = new Date(end.getTime() - MAX_RANGE_DAYS * 86_400_000);
  const parsed = publishedAt ? new Date(publishedAt) : earliest;
  if (!Number.isFinite(parsed.getTime()) || parsed > end || parsed < earliest) return isoDate(earliest);
  return isoDate(parsed);
}

export class PinterestProvider implements SocialActivityProvider {
  readonly platform = "Pinterest";

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    return new Set(["metrics"]);
  }

  async getPostMetrics(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
  ): Promise<SocialActivityResult<SocialPostMetrics>> {
    if (!hasId(post.nativePostId, PIN_ID)) return invalidRequest(this.platform, "the Pin ID is invalid.");
    const end = new Date();
    const start = startDate(post.publishedAt, end);
    const url = new URL(`https://api.pinterest.com/v5/pins/${encodeURIComponent(post.nativePostId)}/analytics`);
    url.searchParams.set("start_date", start);
    url.searchParams.set("end_date", isoDate(end));
    // Pinterest returns period summaries under `all.summary_metrics` when ALL
    // is requested. Do not invent lifetime metrics beyond the 90-day window.
    url.searchParams.set("metric_types", "ALL");
    const response = await requestJson(this.platform, url, { headers: bearer(account.accessToken) });
    if (!response.result.ok) return response.result;
    const metrics = record(record(response.result.data.all).summary_metrics);
    if (Object.keys(metrics).length === 0) return invalidResponse(this.platform);
    const values: Record<string, number> = {};
    for (const [name, value] of Object.entries(metrics)) {
      const parsed = number(value);
      if (parsed !== undefined) values[name] = parsed;
    }
    if (Object.keys(values).length === 0) return invalidResponse(this.platform);
    return resultMetrics(
      post.nativePostId,
      values,
      `${start} to ${isoDate(end)} (Pinterest analytics is limited to the last ${MAX_RANGE_DAYS} days)`,
    );
  }
}
