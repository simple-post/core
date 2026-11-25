import {
  bearer,
  hasId,
  invalidRequest,
  invalidResponse,
  page,
  pageLimit,
  record,
  requestJson,
  safeCursor,
  string,
  trimmedReply,
  uncertainReply,
  uncertainWrite,
} from "./shared";

import type { JsonRecord } from "./shared";
import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialComment,
  SocialLike,
  SocialLikeRequest,
  SocialReply,
  SocialReplyRequest,
  SocialActivityResult,
  SocialActivityPage,
} from "../types/social";

const X_ID = /^\d+$/u;
const RECENT_SEARCH_COVERAGE = "X recent search retention applies; older replies may not be returned.";

export class XProvider implements SocialActivityProvider {
  readonly platform = "X";

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    return new Set(["comments", "replies", "quotes", "likes"]);
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
    const authorId = string(tweet.author_id);
    const author = users.get(authorId ?? "");
    const metrics = record(tweet.public_metrics);
    return {
      nativeId: id,
      nativePostId,
      nativeUrl: `https://x.com/i/web/status/${id}`,
      body: string(tweet.text) ?? "",
      createdAt: string(tweet.created_at),
      author: authorId
        ? {
            id: authorId,
            name: string(author?.name),
            username: string(author?.username),
            avatarUrl: string(author?.profile_image_url),
          }
        : undefined,
      likeCount: typeof metrics.like_count === "number" ? metrics.like_count : undefined,
      replyCount: typeof metrics.reply_count === "number" ? metrics.reply_count : undefined,
      kind: "reply",
      canReply: true,
      canLike: true,
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
        "tweet.fields": "author_id,created_at,conversation_id,public_metrics,referenced_tweets",
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
          .filter((entry) => {
            const references = record(entry).referenced_tweets;
            if (!Array.isArray(references)) return false;
            return references.some((value) => {
              const reference = record(value);
              return (
                reference.type === "replied_to" &&
                (post.nativePostId === conversation.data || reference.id === post.nativePostId)
              );
            });
          })
          .map((entry) => this.tweet(entry, post.nativePostId, conversation.data, users))
          .filter((entry): entry is SocialComment => entry !== null),
        string(record(response.result.data.meta).next_token),
        `${RECENT_SEARCH_COVERAGE} Replies are resolved through the root conversation for thread segments.`,
      ),
    };
  }

  async listPostQuotes(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    if (!this.validId(post.nativePostId)) return invalidRequest(this.platform, "the post ID is invalid.");
    const cursor = safeCursor(options.cursor);
    if (options.cursor && !cursor) return invalidRequest(this.platform, "the page cursor is invalid.");
    const response = await requestJson(
      this.platform,
      this.url(`tweets/${post.nativePostId}/quote_tweets`, {
        "tweet.fields": "author_id,created_at",
        "user.fields": "name,username,profile_image_url",
        expansions: "author_id",
        max_results: String(Math.max(10, pageLimit(options.limit))),
        ...(cursor ? { pagination_token: cursor } : {}),
      }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const body = response.result.data;
    const users = this.users(body);
    const entries = Array.isArray(body.data) ? body.data : [];
    return {
      ok: true,
      data: page(
        entries.flatMap((entry) => {
          const item = this.tweet(entry, post.nativePostId, post.nativePostId, users);
          return item ? [{ ...item, kind: "quote" as const }] : [];
        }),
        string(record(body.meta).next_token),
        "X quote lookup returns quotes visible to this connection.",
      ),
    };
  }

  async likeItem({ account, target }: SocialLikeRequest): Promise<SocialActivityResult<SocialLike>> {
    if (!this.validId(account.platformAccountId) || !this.validId(target.nativeId))
      return invalidRequest(this.platform, "the user or post ID is invalid.");
    const { result } = await requestJson(this.platform, this.url(`users/${account.platformAccountId}/likes`), {
      method: "POST",
      headers: { ...bearer(account.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ tweet_id: target.nativeId }),
    });
    if (!result.ok) return result;
    return record(result.data.data).liked === true
      ? { ok: true, data: { liked: true } }
      : uncertainWrite(this.platform);
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
