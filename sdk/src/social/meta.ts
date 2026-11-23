import {
  bearer,
  hasId,
  invalidRequest,
  invalidResponse,
  metaNext,
  number,
  page,
  pageLimit,
  record,
  requestJson,
  safeCursor,
  string,
  trimmedReply,
  uncertainReply,
  uncertainWrite,
  unsupported,
} from "./shared";

import type { JsonRecord } from "./shared";
import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPage,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialComment,
  SocialLike,
  SocialLikeRequest,
  SocialReply,
  SocialReplyRequest,
  SocialActivityResult,
} from "../types/social";

type MetaKind = "facebook" | "instagram" | "threads";
const META_ID = /^[0-9_]+$/u;

function comment(
  value: unknown,
  nativePostId: string,
  canReply: boolean,
  fallbackUsername?: string,
  fallbackNativeUrl?: (nativeId: string) => string | undefined,
): SocialComment | null {
  const item = record(value);
  const id = string(item.id);
  if (!id) return null;
  const author = record(item.from);
  return {
    nativeId: id,
    nativePostId,
    nativeUrl: string(item.permalink_url) ?? string(item.permalink) ?? fallbackNativeUrl?.(id),
    body: string(item.message) ?? string(item.text) ?? "",
    createdAt: string(item.created_time) ?? string(item.timestamp),
    author: {
      id: string(author.id),
      name: string(author.name) ?? string(item.username) ?? fallbackUsername,
      username: string(item.username) ?? fallbackUsername,
    },
    likeCount: number(item.like_count),
    replyCount: number(item.comment_count),
    canReply,
  };
}

function instagramCommentUrl(postUrl: string | undefined, nativeId: string): string | undefined {
  if (!postUrl) return undefined;
  try {
    const url = new URL(postUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    // Instagram's comment edge does not return a permalink. Preserve the
    // post Visit link and use its supported comment identifier when present.
    url.searchParams.set("comment_id", nativeId);
    return url.toString();
  } catch {
    return undefined;
  }
}

export class MetaProvider implements SocialActivityProvider {
  readonly platform: string;
  private readonly kind: MetaKind;
  private readonly base: string;

  constructor(kind: MetaKind) {
    this.kind = kind;
    if (kind === "facebook") {
      this.platform = "Facebook";
      this.base = "https://graph.facebook.com/v25.0/";
    } else if (kind === "instagram") {
      this.platform = "Instagram";
      this.base = "https://graph.instagram.com/v25.0/";
    } else {
      this.platform = "Threads";
      this.base = "https://graph.threads.net/v1.0/";
    }
  }

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    if (this.kind === "facebook") return new Set(["comments", "replies", "likes"]);
    if (this.kind === "instagram") return new Set(["comments", "replies"]);
    return new Set(["comments", "replies"]);
  }

  private url(path: string, params: Record<string, string> = {}): URL {
    const url = new URL(path, this.base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  private validId(value: string): boolean {
    return hasId(value, META_ID);
  }

  private metaPage<T>(
    body: JsonRecord,
    map: (value: unknown) => T | null,
    coverage?: string,
  ): SocialActivityPage<T> | null {
    if (!Array.isArray(body.data)) return null;
    return page(
      body.data.map((value) => map(value)).filter((value): value is T => value !== null),
      metaNext(body),
      coverage,
    );
  }

  async listPostComments(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    if (!this.validId(post.nativePostId)) return invalidRequest(this.platform, "the post ID is invalid.");
    const cursor = safeCursor(options.cursor);
    if (options.cursor && !cursor) return invalidRequest(this.platform, "the page cursor is invalid.");
    let fields: string;
    if (this.kind === "facebook") {
      fields = "id,message,from,created_time,permalink_url,like_count,comment_count,user_likes,parent";
    } else if (this.kind === "instagram") {
      fields = "id,text,timestamp,username,like_count,replies.limit(50){id,text,timestamp,username,like_count}";
    } else {
      fields = "id,text,timestamp,username,permalink";
    }
    const path = this.kind === "threads" ? `${post.nativePostId}/conversation` : `${post.nativePostId}/comments`;
    const response = await requestJson(
      this.platform,
      this.url(path, {
        fields,
        limit: String(pageLimit(options.limit)),
        ...(this.kind === "facebook" ? { filter: "stream" } : {}),
        ...(cursor ? { after: cursor } : {}),
      }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const mapped = this.metaPage(response.result.data, (value) =>
      comment(
        value,
        post.nativePostId,
        true,
        undefined,
        this.kind === "instagram" ? (id) => instagramCommentUrl(post.nativeUrl, id) : undefined,
      ),
    );
    if (!mapped) return invalidResponse(this.platform);
    if (this.kind === "facebook") {
      const rows = response.result.data.data as unknown[];
      const byId = new Map(rows.map((row) => [string(record(row).id), record(row)]));
      mapped.data = mapped.data.map((item) => {
        const row = byId.get(item.nativeId);
        return {
          ...item,
          kind: record(row?.parent).id ? "reply" : "comment",
          canLike: true,
          liked: typeof row?.user_likes === "boolean" ? row.user_likes : undefined,
        };
      });
    }
    if (this.kind === "threads") mapped.data = mapped.data.map((item) => ({ ...item, kind: "reply" }));
    if (this.kind !== "instagram")
      return {
        ok: true as const,
        data:
          this.kind === "facebook"
            ? page(
                mapped.data,
                mapped.nextCursor,
                "Facebook returns comments in a stream that includes nested replies when available.",
              )
            : mapped,
      };

    // The Instagram comments edge returns first-level comments and may include
    // a bounded first page of child replies. Keep child rows readable without
    // claiming the inline expansion covers all of them.
    const rows = response.result.data.data;
    if (!Array.isArray(rows)) return invalidResponse(this.platform);
    const nested: SocialComment[] = rows.flatMap((value) => {
      const parent = record(value);
      const parentId = string(parent.id) ?? post.nativePostId;
      const replies = record(parent.replies).data;
      return Array.isArray(replies)
        ? replies.flatMap((reply) => {
            const mapped = comment(reply, post.nativePostId, true, undefined, (id) =>
              instagramCommentUrl(post.nativeUrl, id),
            );
            return mapped ? [{ ...mapped, kind: "reply" as const, replyTarget: { instagramParentId: parentId } }] : [];
          })
        : [];
    });
    return {
      ok: true as const,
      data: page(
        [...mapped.data, ...nested],
        mapped.nextCursor,
        nested.length > 0 ? "Instagram returns a bounded inline set of nested replies." : undefined,
      ),
    };
  }

  async likeItem({ account, target }: SocialLikeRequest): Promise<SocialActivityResult<SocialLike>> {
    if (this.kind !== "facebook") return unsupported(this.platform, "comment likes");
    if (!this.validId(target.nativeId)) return invalidRequest(this.platform, "the comment ID is invalid.");
    const { result } = await requestJson(this.platform, this.url(`${target.nativeId}/likes`), {
      method: "POST",
      headers: bearer(account.accessToken),
    });
    if (!result.ok) return result;
    return result.data.success === true ? { ok: true, data: { liked: true } } : uncertainWrite(this.platform);
  }

  async replyToComment(request: SocialReplyRequest): Promise<SocialActivityResult<SocialReply>> {
    if (!this.validId(request.target.nativeId)) return invalidRequest(this.platform, "the reply target is invalid.");
    let maximum = 8000;
    if (this.kind === "threads") maximum = 500;
    else if (this.kind === "instagram") maximum = 2200;
    const text = trimmedReply(this.platform, request.text, maximum);
    if (typeof text !== "string") return text;

    if (this.kind === "threads") {
      if (!this.validId(request.account.platformAccountId))
        return invalidRequest(this.platform, "the account ID is invalid.");
      const create = await requestJson(this.platform, this.url(`${request.account.platformAccountId}/threads`), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          media_type: "TEXT",
          text,
          reply_to_id: request.target.nativeId,
          access_token: request.account.accessToken,
        }),
      });
      if (!create.result.ok) return create.result;
      const creationId = string(create.result.data.id);
      if (!creationId || !this.validId(creationId)) return uncertainReply<SocialReply>(this.platform);
      const publish = await requestJson(
        this.platform,
        this.url(`${request.account.platformAccountId}/threads_publish`),
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ creation_id: creationId, access_token: request.account.accessToken }),
        },
      );
      if (!publish.result.ok) return publish.result;
      const id = string(publish.result.data.id);
      return id
        ? { ok: true as const, data: { nativeId: id, createdAt: new Date().toISOString() } }
        : uncertainReply<SocialReply>(this.platform);
    }

    const parentId = string(request.target.replyTarget?.instagramParentId) ?? request.target.nativeId;
    if (!this.validId(parentId)) return invalidRequest(this.platform, "the Instagram reply parent is invalid.");
    const path = this.kind === "instagram" ? `${parentId}/replies` : `${request.target.nativeId}/comments`;
    const response = await requestJson(this.platform, this.url(path), {
      method: "POST",
      headers: { ...bearer(request.account.accessToken), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message: text }),
    });
    if (!response.result.ok) return response.result;
    const id = string(response.result.data.id);
    return id
      ? { ok: true as const, data: { nativeId: id, createdAt: new Date().toISOString() } }
      : uncertainReply<SocialReply>(this.platform);
  }
}
