import {
  bearer,
  hasId,
  invalidRequest,
  invalidResponse,
  number,
  numeric,
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

import type {
  SocialActivityAccount,
  SocialActivityCapability,
  SocialActivityPage,
  SocialActivityPostTarget,
  SocialActivityProvider,
  SocialComment,
  SocialReply,
  SocialReplyRequest,
  SocialActivityResult,
  SocialPostMetrics,
} from "../types/social";

const VIDEO_ID = /^[A-Za-z0-9_-]{6,128}$/u;
const COMMENT_ID = /^[A-Za-z0-9_.-]{6,256}$/u;
const MAX_THREAD_PARENTS_PER_PAGE = 4;

interface ReplyParent {
  id: string;
  canReply: boolean;
}

interface ReplyCursor {
  parentId: string;
  parentPageToken?: string;
  pendingParents: ReplyParent[];
  threadPageToken?: string;
  canReply: boolean;
}

function encodeReplyCursor(cursor: ReplyCursor): string | undefined {
  const value = `yt-replies:${Buffer.from(JSON.stringify(cursor)).toString("base64url")}`;
  return safeCursor(value);
}

function decodeReplyCursor(value: string): ReplyCursor | null {
  if (!value.startsWith("yt-replies:")) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value.slice("yt-replies:".length), "base64url").toString("utf8")) as unknown;
    const cursor = record(decoded);
    const parentId = string(cursor.parentId);
    const parentPageToken = string(cursor.parentPageToken);
    const threadPageToken = string(cursor.threadPageToken);
    const pending = Array.isArray(cursor.pendingParents)
      ? cursor.pendingParents
          .map((value) => record(value))
          .flatMap((parent) => {
            const id = string(parent.id);
            return id && hasId(id, COMMENT_ID) ? [{ id, canReply: parent.canReply === true }] : [];
          })
      : [];
    if (!parentId || !hasId(parentId, COMMENT_ID) || pending.length > MAX_THREAD_PARENTS_PER_PAGE - 1) return null;
    return {
      parentId,
      parentPageToken: safeCursor(parentPageToken),
      pendingParents: pending,
      threadPageToken: safeCursor(threadPageToken),
      canReply: cursor.canReply === true,
    };
  } catch {
    return null;
  }
}

function visit(videoId: string, commentId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&lc=${encodeURIComponent(commentId)}`;
}

export class YouTubeProvider implements SocialActivityProvider {
  readonly platform = "YouTube";

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    return new Set(["metrics", "comments", "replies"]);
  }

  private url(path: string, params: Record<string, string>): URL {
    const url = new URL(path, "https://www.googleapis.com/youtube/v3/");
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  private validVideoId(value: string): boolean {
    return hasId(value, VIDEO_ID);
  }

  private topLevelComment(value: unknown, videoId: string): { comment: SocialComment; needsReplies: boolean } | null {
    const thread = record(value);
    const threadSnippet = record(thread.snippet);
    const item = record(threadSnippet.topLevelComment);
    const snippet = record(item.snippet);
    const id = string(item.id);
    if (!id || !hasId(id, COMMENT_ID)) return null;
    const canReply = threadSnippet.canReply === true;
    return {
      comment: {
        nativeId: id,
        nativePostId: videoId,
        nativeUrl: visit(videoId, id),
        // `textOriginal` is the author text. `textDisplay` can include
        // formatting supplied by the API even with textFormat=plainText.
        body: string(snippet.textOriginal) ?? string(snippet.textDisplay) ?? "",
        createdAt: string(snippet.publishedAt),
        author: {
          name: string(snippet.authorDisplayName),
          username: string(snippet.authorChannelUrl),
          avatarUrl: string(snippet.authorProfileImageUrl),
        },
        likeCount: number(snippet.likeCount),
        replyCount: number(threadSnippet.totalReplyCount),
        canReply,
        replyTarget: { topLevelCommentId: id },
      },
      needsReplies: (number(threadSnippet.totalReplyCount) ?? 0) > 0,
    };
  }

  private replyComment(
    value: unknown,
    videoId: string,
    topLevelCommentId: string,
    canReply: boolean,
  ): SocialComment | null {
    const item = record(value);
    const snippet = record(item.snippet);
    const id = string(item.id);
    if (!id || !hasId(id, COMMENT_ID)) return null;
    return {
      nativeId: id,
      nativePostId: videoId,
      nativeUrl: visit(videoId, id),
      body: string(snippet.textOriginal) ?? string(snippet.textDisplay) ?? "",
      createdAt: string(snippet.publishedAt),
      author: {
        name: string(snippet.authorDisplayName),
        username: string(snippet.authorChannelUrl),
        avatarUrl: string(snippet.authorProfileImageUrl),
      },
      likeCount: number(snippet.likeCount),
      canReply,
      replyTarget: { topLevelCommentId },
    };
  }

  private async getReplyPage(
    account: SocialActivityAccount,
    videoId: string,
    cursor: ReplyCursor,
    requestedLimit: number,
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    const response = await requestJson(
      this.platform,
      this.url("comments", {
        part: "snippet",
        parentId: cursor.parentId,
        textFormat: "plainText",
        maxResults: String(requestedLimit),
        ...(cursor.parentPageToken ? { pageToken: cursor.parentPageToken } : {}),
      }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const entries = response.result.data.items;
    if (!Array.isArray(entries)) return invalidResponse(this.platform);
    const nextReplyToken = string(response.result.data.nextPageToken);
    let next = cursor.threadPageToken;
    if (nextReplyToken) {
      next = encodeReplyCursor({ ...cursor, parentPageToken: nextReplyToken });
    } else if (cursor.pendingParents.length > 0) {
      next = encodeReplyCursor({
        parentId: cursor.pendingParents[0].id,
        pendingParents: cursor.pendingParents.slice(1),
        threadPageToken: cursor.threadPageToken,
        canReply: cursor.pendingParents[0].canReply,
      });
    }
    return {
      ok: true,
      data: page(
        entries
          .map((entry) => this.replyComment(entry, videoId, cursor.parentId, cursor.canReply))
          .filter((entry): entry is SocialComment => entry !== null),
        next,
        "YouTube replies are fetched through bounded nested-comment continuation pages.",
      ),
    };
  }

  async getPostMetrics(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
  ): Promise<SocialActivityResult<SocialPostMetrics>> {
    if (!this.validVideoId(post.nativePostId)) return invalidRequest(this.platform, "the video ID is invalid.");
    const response = await requestJson(
      this.platform,
      this.url("videos", { part: "statistics", id: post.nativePostId }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const item = record(Array.isArray(response.result.data.items) ? response.result.data.items[0] : undefined);
    if (!string(item.id)) return invalidRequest(this.platform, "the video was not found for this connected channel.");
    const values: Record<string, number> = {};
    for (const [key, value] of Object.entries(record(item.statistics))) {
      const parsed = numeric(value);
      if (parsed !== undefined) values[key] = parsed;
    }
    if (Object.keys(values).length === 0) return invalidResponse(this.platform);
    return resultMetrics(post.nativePostId, values);
  }

  async listPostComments(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    if (!this.validVideoId(post.nativePostId)) return invalidRequest(this.platform, "the video ID is invalid.");
    const cursor = safeCursor(options.cursor);
    if (options.cursor && !cursor) return invalidRequest(this.platform, "the page cursor is invalid.");
    const requestedLimit = Math.min(pageLimit(options.limit), MAX_THREAD_PARENTS_PER_PAGE);
    const replyCursor = cursor ? decodeReplyCursor(cursor) : null;
    if (cursor?.startsWith("yt-replies:") && !replyCursor)
      return invalidRequest(this.platform, "the reply page cursor is invalid.");
    if (replyCursor) {
      const result = await this.getReplyPage(account, post.nativePostId, replyCursor, requestedLimit);
      return result;
    }

    const response = await requestJson(
      this.platform,
      this.url("commentThreads", {
        part: "snippet",
        videoId: post.nativePostId,
        textFormat: "plainText",
        maxResults: String(requestedLimit),
        ...(cursor ? { pageToken: cursor } : {}),
      }),
      { headers: bearer(account.accessToken) },
    );
    if (!response.result.ok) return response.result;
    const entries = response.result.data.items;
    if (!Array.isArray(entries)) return invalidResponse(this.platform);
    const topLevel = entries
      .map((entry) => this.topLevelComment(entry, post.nativePostId))
      .filter((entry): entry is { comment: SocialComment; needsReplies: boolean } => entry !== null);
    const parents = topLevel
      .filter((entry) => entry.needsReplies)
      .map((entry) => ({ id: entry.comment.nativeId, canReply: entry.comment.canReply }));
    const nextThreadToken = string(response.result.data.nextPageToken);
    if (parents.length === 0)
      return {
        ok: true as const,
        data: page(
          topLevel.map((entry) => entry.comment),
          nextThreadToken,
        ),
      };

    const first = topLevel.find((entry) => entry.needsReplies)!;
    const replyPage = await this.getReplyPage(
      account,
      post.nativePostId,
      {
        parentId: first.comment.nativeId,
        pendingParents: parents.filter((parent) => parent.id !== first.comment.nativeId),
        threadPageToken: nextThreadToken,
        canReply: first.comment.canReply,
      },
      requestedLimit,
    );
    if (!replyPage.ok) return replyPage;
    return {
      ok: true as const,
      data: page(
        [...topLevel.map((entry) => entry.comment), ...replyPage.data.data],
        replyPage.data.nextCursor,
        "YouTube replies are fetched through bounded nested-comment continuation pages.",
      ),
    };
  }

  async replyToComment(request: SocialReplyRequest): Promise<SocialActivityResult<SocialReply>> {
    const target = string(request.target.replyTarget?.topLevelCommentId) ?? request.target.nativeId;
    if (!hasId(target, COMMENT_ID)) return invalidRequest(this.platform, "the top-level comment ID is invalid.");
    const text = trimmedReply(this.platform, request.text, 10_000);
    if (typeof text !== "string") return text;
    const response = await requestJson(this.platform, this.url("comments", { part: "snippet" }), {
      method: "POST",
      headers: { ...bearer(request.account.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ snippet: { parentId: target, textOriginal: text } }),
    });
    if (!response.result.ok) return response.result;
    const id = string(response.result.data.id);
    return id
      ? {
          ok: true as const,
          data: {
            nativeId: id,
            nativeUrl: request.target.nativePostId ? visit(request.target.nativePostId, id) : undefined,
            createdAt: new Date().toISOString(),
          },
        }
      : uncertainReply<SocialReply>(this.platform);
  }
}
