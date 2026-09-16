import axios from "axios";

import {
  failure,
  hasId,
  invalidRequest,
  invalidResponse,
  number,
  page,
  pageLimit,
  record,
  resultMetrics,
  safeCursor,
  string,
} from "./shared";

import { foremSafeLookup, normalizeForemInstanceUrl } from "../publishers/forem/security";

import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPage,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialActivityResult,
  SocialComment,
  SocialPostMetrics,
} from "../types/social";

const ARTICLE_ID = /^\d{1,32}$/u;
const COMMENT_ID = /^[A-Za-z0-9_-]{1,128}$/u;
const MAX_NESTED_COMMENTS = 100;

function plainTextHtml(value: string): string {
  return value
    .replaceAll(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, " ")
    .replaceAll(/<[^>]*>/gu, " ")
    .replaceAll(/&(nbsp|#160);/giu, " ")
    .replaceAll(/&amp;/giu, "&")
    .replaceAll(/&lt;/giu, "<")
    .replaceAll(/&gt;/giu, ">")
    .replaceAll(/&(apos|#39);/giu, "'")
    .replaceAll(/&quot;/giu, '"')
    .replaceAll(/\s+/gu, " ")
    .trim();
}

function baseUrl(account: SocialActivityAccount): string | undefined {
  const instanceUrl = string(account.credentials?.instanceUrl) ?? "https://dev.to";
  try {
    return normalizeForemInstanceUrl(instanceUrl);
  } catch {
    return undefined;
  }
}

function responseError<T>(status: number): SocialActivityResult<T> {
  if (status === 401) return failure("DEV/Forem", "authentication", "the account needs to be reconnected.");
  if (status === 403) return failure("DEV/Forem", "permission_required", "the connection cannot access this article.");
  if (status === 404) return failure("DEV/Forem", "not_found", "the article was not found.");
  if (status === 429)
    return failure("DEV/Forem", "rate_limited", "the provider rate limited this request. Try again later.");
  return failure("DEV/Forem", status >= 500 ? "transient" : "invalid_response", "the provider rejected this request.");
}

export class ForemProvider implements SocialActivityProvider {
  readonly platform = "DEV/Forem";

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    // Forem has no native reply endpoint for this API connection. Comments are
    // readable but deliberately remain non-replyable in the first release.
    return new Set(["metrics", "comments"]);
  }

  private async get(
    account: SocialActivityAccount,
    path: string,
  ): Promise<SocialActivityResult<Record<string, unknown> | unknown[]>> {
    const origin = baseUrl(account);
    if (!origin) return invalidRequest(this.platform, "the configured Forem instance URL is invalid.");
    try {
      const response = await axios.get(new URL(path, `${origin}/`).toString(), {
        headers: { "api-key": account.accessToken, Accept: "application/vnd.forem.api-v1+json" },
        timeout: 30_000,
        maxRedirects: 0,
        lookup: foremSafeLookup,
        validateStatus: () => true,
      });
      if (response.status < 200 || response.status >= 300) return responseError(response.status);
      if (!response.data || (typeof response.data !== "object" && !Array.isArray(response.data)))
        return invalidResponse(this.platform);
      return { ok: true, data: response.data as Record<string, unknown> | unknown[] };
    } catch {
      return failure(this.platform, "transient", "the provider could not be reached. Try again.");
    }
  }

  async getPostMetrics(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
  ): Promise<SocialActivityResult<SocialPostMetrics>> {
    if (!hasId(post.nativePostId, ARTICLE_ID)) return invalidRequest(this.platform, "the Forem article ID is invalid.");
    const response = await this.get(account, `api/articles/${encodeURIComponent(post.nativePostId)}`);
    if (!response.ok) return response;
    const article = record(response.data);
    if (string(article.id) !== post.nativePostId && number(article.id) !== Number(post.nativePostId))
      return invalidResponse(this.platform);
    const values: Record<string, number> = {};
    for (const name of ["positive_reactions_count", "public_reactions_count", "comments_count", "page_views_count"]) {
      const value = number(article[name]);
      if (value !== undefined) values[name] = value;
    }
    return Object.keys(values).length > 0 ? resultMetrics(post.nativePostId, values) : invalidResponse(this.platform);
  }

  private comment(value: unknown, nativePostId: string, origin: string): SocialComment | null {
    const item = record(value);
    // Forem comments are identified by `id_code` (for example, `m3m0`), not
    // the numeric article ID. Keep the opaque code intact for deep links.
    const id = string(item.id_code);
    if (!id || !hasId(id, COMMENT_ID)) return null;
    const user = record(item.user);
    const username = string(user.username);
    const nativeUrl = username
      ? new URL(`${encodeURIComponent(username)}/comment/${encodeURIComponent(id)}`, `${origin}/`).toString()
      : undefined;
    return {
      nativeId: id,
      nativePostId,
      ...(nativeUrl ? { nativeUrl } : {}),
      body: string(item.body_markdown) ?? plainTextHtml(string(item.body_html) ?? ""),
      createdAt: string(item.created_at),
      author: {
        name: string(user.name),
        username,
        avatarUrl: string(user.profile_image_90) ?? string(user.profile_image),
      },
      canReply: false,
    };
  }

  async listPostComments(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    if (!hasId(post.nativePostId, ARTICLE_ID)) return invalidRequest(this.platform, "the Forem article ID is invalid.");
    const cursor = safeCursor(options.cursor);
    if (options.cursor && (!cursor || !/^\d{1,9}$/u.test(cursor)))
      return invalidRequest(this.platform, "the page cursor is invalid.");
    const origin = baseUrl(account);
    if (!origin) return invalidRequest(this.platform, "the configured Forem instance URL is invalid.");
    const limit = pageLimit(options.limit);
    const response = await this.get(
      account,
      `api/comments?a_id=${encodeURIComponent(post.nativePostId)}&page=${encodeURIComponent(cursor ?? "1")}&per_page=${limit}`,
    );
    if (!response.ok) return response;
    if (!Array.isArray(response.data)) return invalidResponse(this.platform);
    const comments = response.data
      .map((value) => this.comment(value, post.nativePostId, origin))
      .filter((value): value is SocialComment => value !== null);
    const nested: SocialComment[] = [];
    const visitChildren = (value: unknown): void => {
      if (nested.length >= MAX_NESTED_COMMENTS) return;
      const children = record(value).children;
      for (const child of Array.isArray(children) ? children : []) {
        if (nested.length >= MAX_NESTED_COMMENTS) return;
        const mapped = this.comment(child, post.nativePostId, origin);
        if (mapped) nested.push(mapped);
        visitChildren(child);
      }
    };
    for (const value of response.data) visitChildren(value);
    return {
      ok: true,
      data: page(
        [...comments, ...nested],
        response.data.length >= limit ? String(Number(cursor ?? "1") + 1) : undefined,
        "Forem pages top-level comment threads. Nested replies are inline and limited to 100 rows per page.",
      ),
    };
  }
}
