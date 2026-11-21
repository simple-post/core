import axios from "axios";

import { AnalyticsError, postAnalyticsResult, toFiniteNumber } from "../../utils/analytics";
import { httpStatus } from "../../utils/transient-retry";

import type { AccountAnalytics, AnalyticsTarget, PostAnalytics, PostMetric, PostMetrics } from "../../analytics";

const REST_BASE = "https://api.linkedin.com/rest";
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Member post analytics (Community Management API, scope
 * r_member_postAnalytics). Each metric is a separate request, so only the
 * most useful ones are read.
 */
const QUERY_TYPES: Array<[queryType: string, metric: PostMetric]> = [
  ["IMPRESSION", "views"],
  ["MEMBERS_REACHED", "reach"],
  ["REACTION", "likes"],
  ["COMMENT", "comments"],
  ["RESHARE", "shares"],
];

/** Builds the Rest.li union key for a share or ugcPost URN. */
export function linkedInEntity(urn: string): string | undefined {
  if (urn.startsWith("urn:li:share:")) return `(share:${encodeURIComponent(urn)})`;
  if (urn.startsWith("urn:li:ugcPost:")) return `(ugc:${encodeURIComponent(urn)})`;
  return undefined;
}

function headers(accessToken: string, version: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    "X-Restli-Protocol-Version": "2.0.0",
    "Linkedin-Version": version,
  };
}

function permissionError(error: unknown): never {
  if (httpStatus(error) === 403) {
    throw new AnalyticsError(
      "missing_permission",
      "LinkedIn did not grant access to post analytics. It requires an app approved for the Community Management API (r_member_postAnalytics).",
    );
  }
  throw error;
}

async function readCount(accessToken: string, version: string, entity: string, queryType: string): Promise<number> {
  // Rest.li parameters are pre-encoded; axios must not encode them again.
  const url = `${REST_BASE}/memberCreatorPostAnalytics?q=entity&entity=${entity}&queryType=${queryType}&aggregation=TOTAL`;
  const response = await axios.get<{ elements?: Array<{ count?: unknown }> }>(url, {
    headers: headers(accessToken, version),
    timeout: REQUEST_TIMEOUT_MS,
  });
  return (response.data?.elements ?? []).reduce((sum, element) => sum + (toFiniteNumber(element.count) ?? 0), 0);
}

export async function fetchLinkedInPostAnalytics(
  accessToken: string,
  version: string,
  targets: AnalyticsTarget[],
): Promise<PostAnalytics[]> {
  const results: PostAnalytics[] = [];
  for (const target of targets) {
    const entity = linkedInEntity(target.postId);
    if (!entity) {
      results.push(
        postAnalyticsResult("linkedin", target.postId, "unsupported", {
          message: "This LinkedIn post id is not a share or ugcPost URN.",
        }),
      );
      continue;
    }
    const metrics: PostMetrics = {};
    const platformMetrics: Record<string, number> = {};
    try {
      for (const [queryType, metric] of QUERY_TYPES) {
        const count = await readCount(accessToken, version, entity, queryType);
        metrics[metric] = count;
        platformMetrics[queryType] = count;
      }
    } catch (error) {
      if (httpStatus(error) === 404) {
        results.push(
          postAnalyticsResult("linkedin", target.postId, "not_found", {
            message: "LinkedIn could not find this post. It may have been deleted.",
          }),
        );
        continue;
      }
      permissionError(error);
    }
    results.push(
      postAnalyticsResult("linkedin", target.postId, "ok", {
        metrics,
        platformMetrics,
        url: `https://www.linkedin.com/feed/update/${target.postId}/`,
      }),
    );
  }
  return results;
}

export async function fetchLinkedInAccountAnalytics(accessToken: string, version: string): Promise<AccountAnalytics> {
  try {
    const response = await axios.get<{ elements?: Array<{ memberFollowersCount?: unknown }> }>(
      `${REST_BASE}/memberFollowersCount?q=me`,
      { headers: headers(accessToken, version), timeout: REQUEST_TIMEOUT_MS },
    );
    const followers = toFiniteNumber(response.data?.elements?.[0]?.memberFollowersCount);
    return {
      platform: "linkedin",
      status: "ok",
      metrics: followers === undefined ? {} : { followers },
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (httpStatus(error) === 403) {
      throw new AnalyticsError(
        "missing_permission",
        "LinkedIn did not grant access to follower counts. It requires the r_member_profileAnalytics permission (Community Management API).",
      );
    }
    throw error;
  }
}
