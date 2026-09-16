import {
  bearer,
  hasId,
  invalidRequest,
  invalidResponse,
  page,
  pageLimit,
  record,
  requestJson,
  resultMetrics,
  safeCursor,
  string,
  trimmedReply,
  uncertainReply,
} from "./shared";

import type { JsonRecord } from "./shared";
import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialComment,
  SocialMention,
  SocialReply,
  SocialReplyRequest,
  SocialActivityResult,
  SocialActivityPage,
  SocialPostMetrics,
} from "../types/social";

const X_ID = /^\d+$/u;
const RECENT_SEARCH_COVERAGE = "X recent search retention applies; older replies may not be returned.";

export class XProvider implements SocialActivityProvider {
  readonly platform = "X";

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    return new Set(["metrics", "comments", "mentions", "replies"]);
  }

  private url(path: string, params: Record<string, string> = {}): URL {
    const url = new URL(path, "https://api.x.com/2/");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  private validId(value: string): boolean {
    return hasId(value, X_ID);
  }

  private users(body: JsonRecord): Map<string, JsonRecord> {
    const included = record(body.includes).users;
    const users = Array.isArray(included) ? included : [];
    return new Map(
      users.flatMap((value) => {
        const user = record(value);
        const id = string(user.id);
        return id ? [[id, user] as const] : [];
      }),
    );
  }

  private tweet(
    value: unknown,
    nativePostId: string,
    excludedConversationRootId: string,
    users: Map<string, JsonRecord>,
  ): SocialComment | null {
    const tweet = record(value);
    const id = string(tweet.id);
    if (!id || id === excludedConversationRootId) return null;
    const author = users.get(string(tweet.author_id) ?? "");
    const metrics = record(tweet.public_metrics);
    return {
      nativeId: id,
      nativePostId,
      nativeUrl: `https://x.com/i/web/status/${id}`,
      body: string(tweet.text) ?? "",
      createdAt: string(tweet.created_at),
      author: author
        ? {
            id: string(author.id),
            name: string(author.name),
            username: string(author.username),
            avatarUrl: string(author.profile_image_url),
          }
        : undefined,
      likeCount: typeof metrics.like_count === "number" ? metrics.like_count : undefined,
      replyCount: typeof metrics.reply_count === "number" ? metrics.reply_count : undefined,
      canReply: true,
    };
  }

  private async conversationId(account: SocialActivityAccount, targetId: string) {
    const response = await requestJson(
      this.platform,
      this.url(`tweets/${encodeURIComponent(targetId)}`, { "tweet.fields": "conversation_id" }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const data = record(response.result.data.data);
    const conversationId = string(data.conversation_id) ?? string(data.id);
    return conversationId && this.validId(conversationId)
      ? { ok: true as const, data: conversationId }
      : invalidResponse<string>(this.platform);
  }

  async getPostMetrics(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
  ): Promise<SocialActivityResult<SocialPostMetrics>> {
    if (!this.validId(post.nativePostId)) return invalidRequest(this.platform, "the post ID is invalid.");
    const response = await requestJson(
      this.platform,
      this.url(`tweets/${encodeURIComponent(post.nativePostId)}`, { "tweet.fields": "public_metrics" }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const data = record(response.result.data.data);
    const metrics = record(data.public_metrics);
    if (!string(data.id) || Object.keys(metrics).length === 0) return invalidResponse(this.platform);
    const values: Record<string, number> = {};
    for (const [name, value] of Object.entries(metrics)) {
      if (typeof value === "number" && Number.isFinite(value)) values[name] = value;
    }
    return resultMetrics(post.nativePostId, values);
  }

  async listPostComments(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    if (!this.validId(post.nativePostId)) return invalidRequest(this.platform, "the post ID is invalid.");
    const cursor = safeCursor(options.cursor);
    if (options.cursor && !cursor) return invalidRequest(this.platform, "the page cursor is invalid.");
    const conversation = await this.conversationId(account, post.nativePostId);
    if (!conversation.ok) return conversation;
    const response = await requestJson(
      this.platform,
      this.url("tweets/search/recent", {
        query: `conversation_id:${conversation.data}`,
        max_results: String(Math.max(10, pageLimit(options.limit))),
        "tweet.fields": "author_id,created_at,conversation_id,public_metrics",
        expansions: "author_id",
        "user.fields": "id,name,username,profile_image_url",
        ...(cursor ? { next_token: cursor } : {}),
      }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const entries = response.result.data.data;
    if (!Array.isArray(entries)) return invalidResponse(this.platform);
    const users = this.users(response.result.data);
    return {
      ok: true as const,
      data: page(
        entries
          .map((entry) => this.tweet(entry, post.nativePostId, conversation.data, users))
          .filter((entry): entry is SocialComment => entry !== null),
        string(record(response.result.data.meta).next_token),
        `${RECENT_SEARCH_COVERAGE} Replies are resolved through the root conversation for thread segments.`,
      ),
    };
  }

  async listMentions(
    account: SocialActivityAccount,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialMention>>> {
    if (!this.validId(account.platformAccountId)) return invalidRequest(this.platform, "the account ID is invalid.");
    const cursor = safeCursor(options.cursor);
    if (options.cursor && !cursor) return invalidRequest(this.platform, "the page cursor is invalid.");
    const response = await requestJson(
      this.platform,
      this.url(`users/${encodeURIComponent(account.platformAccountId)}/mentions`, {
        max_results: String(Math.max(5, pageLimit(options.limit))),
        "tweet.fields": "author_id,created_at,conversation_id,public_metrics",
        expansions: "author_id",
        "user.fields": "id,name,username,profile_image_url",
        ...(cursor ? { pagination_token: cursor } : {}),
      }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const entries = response.result.data.data;
    if (!Array.isArray(entries)) return invalidResponse(this.platform);
    const users = this.users(response.result.data);
    const data = entries
      .map((entry) => {
        const tweet = record(entry);
        const mapped = this.tweet(entry, "", "", users);
        return mapped
          ? ({ ...mapped, nativePostId: string(tweet.conversation_id) ?? mapped.nativeId } satisfies SocialMention)
          : null;
      })
      .filter((entry): entry is SocialMention => entry !== null);
    return {
      ok: true as const,
      data: page(data, string(record(response.result.data.meta).next_token), RECENT_SEARCH_COVERAGE),
    };
  }

  async replyToComment(request: SocialReplyRequest): Promise<SocialActivityResult<SocialReply>> {
    if (!this.validId(request.target.nativeId)) return invalidRequest(this.platform, "the reply target is invalid.");
    const text = trimmedReply(this.platform, request.text, 280);
    if (typeof text !== "string") return text;
    const response = await requestJson(this.platform, this.url("tweets"), {
      method: "POST",
      headers: { ...bearer(request.account.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ text, reply: { in_reply_to_tweet_id: request.target.nativeId } }),
    });
    if (!response.result.ok) return response.result;
    const id = string(record(response.result.data.data).id);
    return id
      ? {
          ok: true as const,
          data: { nativeId: id, nativeUrl: `https://x.com/i/web/status/${id}`, createdAt: new Date().toISOString() },
        }
      : uncertainReply<SocialReply>(this.platform);
  }
}
