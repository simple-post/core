import {
  epochIso,
  hasId,
  invalidRequest,
  invalidResponse,
  number,
  page,
  pageLimit,
  record,
  requestJson,
  safeCursor,
  string,
  trimmedReply,
  uncertainReply,
} from "./shared";

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

const POST_URN = /^urn:li:(?:share|ugcPost):[A-Za-z0-9_-]{1,256}$/u;
const COMMENT_OBJECT_URN = /^urn:li:(?:share|ugcPost|activity):[A-Za-z0-9_-]{1,256}$/u;
const COMMENT_URN = /^urn:li:comment:\(urn:li:[A-Za-z0-9:_-]{1,512},[A-Za-z0-9_-]{1,256}\)$/u;
const COMMENT_ID = /^[A-Za-z0-9_-]{1,256}$/u;
const LINKEDIN_VERSION = "202606";

function postUrn(post: SocialActivityPostTarget): string | undefined {
  const value = string(post.platformData?.urn) ?? post.nativePostId;
  return value && POST_URN.test(value) ? value : undefined;
}

function actorUrn(account: SocialActivityAccount): string | undefined {
  if (/^urn:li:organization:[0-9]+$/u.test(account.platformAccountId)) return account.platformAccountId;
  if (/^urn:li:person:[A-Za-z0-9_-]{1,256}$/u.test(account.platformAccountId)) return account.platformAccountId;
  return hasId(account.platformAccountId, /^[A-Za-z0-9_-]{1,256}$/u)
    ? `urn:li:person:${account.platformAccountId}`
    : undefined;
}

export class LinkedInProvider implements SocialActivityProvider {
  readonly platform = "LinkedIn";

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    // Comments/replies require LinkedIn's access-gated r/w_member_social_feed
    // permissions; the adapter reports normal permission errors until they are
    // granted. LinkedIn does not provide a general personal mention inbox.
    return new Set(["comments", "replies", "likes"]);
  }

  private url(path: string, params: Record<string, string> = {}): URL {
    const url = new URL(path, "https://api.linkedin.com/");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  private headers(accessToken: string): Record<string, string> {
    return {
      Authorization: `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "Linkedin-Version": LINKEDIN_VERSION,
    };
  }

  private socialActionPath(urn: string): string {
    return `rest/socialActions/${encodeURIComponent(urn)}/comments`;
  }

  private mapComment(value: unknown, nativePostId: string, postNativeUrl?: string): SocialComment | null {
    const item = record(value);
    const id = string(item.id);
    const commentUrn = string(item.commentUrn);
    const objectUrn = string(item.object);
    if (
      !id ||
      !hasId(id, COMMENT_ID) ||
      !commentUrn ||
      !COMMENT_URN.test(commentUrn) ||
      !objectUrn ||
      !COMMENT_OBJECT_URN.test(objectUrn)
    )
      return null;
    const actor = string(item.actor);
    return {
      nativeId: id,
      nativePostId,
      nativeUrl: postNativeUrl,
      body: string(record(item.message).text) ?? "",
      createdAt: epochIso(record(item.created).time),
      author: actor ? { id: actor } : undefined,
      likeCount: number(record(item.likesSummary).totalLikes) ?? number(record(item.likesSummary).aggregatedTotalLikes),
      canReply: true,
      canLike: true,
      replyTarget: { targetUrn: commentUrn, objectUrn },
    };
  }

  async listPostComments(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    const urn = postUrn(post);
    if (!urn) return invalidRequest(this.platform, "the post must be a share or UGC post URN.");
    const cursor = safeCursor(options.cursor);
    if (options.cursor && (!cursor || !/^\d+$/u.test(cursor)))
      return invalidRequest(this.platform, "the page cursor is invalid.");
    const response = await requestJson(
      this.platform,
      this.url(this.socialActionPath(urn), { start: cursor ?? "0", count: String(pageLimit(options.limit)) }),
      { headers: this.headers(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const entries = response.result.data.elements;
    if (!Array.isArray(entries)) return invalidResponse(this.platform);
    const paging = record(response.result.data.paging);
    const start = number(paging.start) ?? Number(cursor ?? "0");
    const count = number(paging.count) ?? entries.length;
    const total = number(paging.total);
    const next = total !== undefined && start + count < total ? String(start + count) : undefined;
    return {
      ok: true as const,
      data: page(
        entries
          .map((entry) => this.mapComment(entry, post.nativePostId, post.nativeUrl))
          .filter((entry): entry is SocialComment => entry !== null),
        next,
        "LinkedIn v1 fetches top-level comments. Nested comment continuation is not exposed in this release.",
      ),
    };
  }

  async likeItem({ account, target }: SocialLikeRequest): Promise<SocialActivityResult<SocialLike>> {
    const entity = string(target.replyTarget?.targetUrn);
    const actor = actorUrn(account);
    if (!actor || !entity || !COMMENT_URN.test(entity))
      return invalidRequest(this.platform, "the LinkedIn reaction target is unavailable.");
    const headers = this.headers(account.accessToken);
    const encodedEntity = encodeURIComponent(entity).replaceAll("(", "%28").replaceAll(")", "%29");
    const key = `(actor:${encodeURIComponent(actor)},entity:${encodedEntity})`;
    const existing = await requestJson(this.platform, this.url(`rest/reactions/${key}`), { headers });
    if (existing.result.ok) return { ok: true, data: { liked: true } };
    if (existing.result.error.code !== "not_found") return existing.result;
    const { result } = await requestJson(
      this.platform,
      this.url("rest/reactions", { actor }),
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ root: entity, reactionType: "LIKE" }),
      },
      { allowEmpty: true },
    );
    return result.ok ? { ok: true, data: { liked: true } } : result;
  }

  async replyToComment(request: SocialReplyRequest): Promise<SocialActivityResult<SocialReply>> {
    const text = trimmedReply(this.platform, request.text, 1250);
    if (typeof text !== "string") return text;
    const target = record(request.target.replyTarget);
    const targetUrn = string(target.targetUrn);
    const objectUrn = string(target.objectUrn);
    const actor = actorUrn(request.account);
    if (!targetUrn || !COMMENT_URN.test(targetUrn) || !objectUrn || !COMMENT_OBJECT_URN.test(objectUrn) || !actor)
      return invalidRequest(
        this.platform,
        "the LinkedIn comment context is unavailable. Refresh the conversation first.",
      );
    const response = await requestJson(this.platform, this.url(this.socialActionPath(targetUrn)), {
      method: "POST",
      headers: { ...this.headers(request.account.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        actor,
        object: objectUrn,
        parentComment: targetUrn,
        message: { text },
      }),
    });
    if (!response.result.ok) return response.result;
    const id = string(response.result.data.id) ?? response.response?.headers.get("x-restli-id") ?? undefined;
    return id && hasId(id, COMMENT_ID)
      ? { ok: true as const, data: { nativeId: id, createdAt: new Date().toISOString() } }
      : uncertainReply<SocialReply>(this.platform);
  }
}
