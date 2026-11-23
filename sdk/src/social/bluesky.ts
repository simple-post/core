import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  bearer,
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
  uncertainWrite,
} from "./shared";

import { createDpopProof } from "../utils/dpop";

import type { JsonRecord, JsonRequestInit, JsonRequestResult } from "./shared";
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

const AT_URI = /^at:\/\/(did:[a-z0-9:.%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~:-]{1,512})$/iu;
const DID = /^did:[a-z0-9:.%-]{3,256}$/iu;
const CID = /^[A-Za-z0-9._~-]{1,512}$/u;
const APPVIEW_PROXY = "did:web:api.bsky.app#bsky_appview";
const MAX_THREAD_COMMENTS = 100;

function postUrl(uri: string): string | undefined {
  const match = AT_URI.exec(uri);
  if (!match) return undefined;
  return `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`;
}

function safePds(value: unknown): URL | null {
  if (typeof value !== "string") return new URL("https://bsky.social/");
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname === "metadata.google.internal" ||
      hostname.startsWith("metadata.") ||
      hostname.endsWith(".internal") ||
      isIP(hostname.replaceAll(/^\[|\]$/gu, "")) !== 0
    )
      return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function bskyUri(post: SocialActivityPostTarget): string | undefined {
  const uri = string(post.platformData?.uri) ?? post.nativePostId;
  return AT_URI.test(uri) ? uri : undefined;
}

function validCid(value: string | undefined): value is string {
  return Boolean(value && hasId(value, CID));
}

export class BlueskyProvider implements SocialActivityProvider {
  readonly platform = "Bluesky";

  getCapabilities(): ReadonlySet<SocialActivityCapability> {
    return new Set(["comments", "replies", "quotes", "likes"]);
  }

  private url(account: SocialActivityAccount, path: string, params: Record<string, string> = {}): URL | null {
    const pds = safePds(account.credentials?.pdsUrl);
    if (!pds) return null;
    const url = new URL(path, pds);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    return url;
  }

  private async request(
    account: SocialActivityAccount,
    url: URL,
    init: JsonRequestInit = {},
  ): Promise<JsonRequestResult> {
    const privateJwk = account.credentials?.dpopPrivateJwk;
    const publicJwk = account.credentials?.dpopPublicJwk;
    const needsDpop = privateJwk !== undefined || publicJwk !== undefined;
    if (needsDpop && (!privateJwk || !publicJwk || typeof privateJwk !== "object" || typeof publicJwk !== "object"))
      return { result: invalidRequest<JsonRecord>(this.platform, "the account DPoP key material is incomplete.") };
    const proxiedAppView = url.pathname.includes("/xrpc/app.bsky.");
    const makeRequest = async (nonce?: string): Promise<JsonRequestResult> => {
      let proof: string | undefined;
      if (needsDpop) {
        try {
          proof = createDpopProof({
            method: init.method ?? "GET",
            url: url.toString(),
            privateJwk: privateJwk as JsonRecord,
            publicJwk: publicJwk as JsonRecord,
            accessToken: account.accessToken,
            nonce,
          });
        } catch {
          return { result: invalidRequest<JsonRecord>(this.platform, "the account DPoP authorization is invalid.") };
        }
      }
      return requestJson(this.platform, url, {
        ...init,
        headers: {
          ...init.headers,
          ...bearer(account.accessToken),
          ...(proof ? { Authorization: `DPoP ${account.accessToken}`, DPoP: proof } : {}),
          ...(proxiedAppView ? { "atproto-proxy": APPVIEW_PROXY } : {}),
        },
      });
    };

    const initial = await makeRequest();
    const bodyError = string(initial.body?.error);
    const nonce = initial.response?.headers.get("dpop-nonce") ?? initial.response?.headers.get("DPoP-Nonce");
    // `use_dpop_nonce` is an explicit challenge. Retry exactly once with the
    // response nonce; DPoP htu is built by the shared helper without query.
    if (needsDpop && bodyError === "use_dpop_nonce" && nonce) return makeRequest(nonce);
    return initial;
  }

  private activity(
    view: JsonRecord,
    nativePostId: string,
    rootUri: string,
    rootCid: string | undefined,
  ): SocialComment | null {
    const uri = string(view.uri);
    const cid = string(view.cid);
    if (!uri || !AT_URI.test(uri)) return null;
    const postRecord = record(view.record);
    const originalReply = record(postRecord.reply);
    const originalRoot = record(originalReply.root);
    const preservedRootUri = string(originalRoot.uri) ?? rootUri;
    const preservedRootCid = string(originalRoot.cid) ?? rootCid;
    return {
      nativeId: uri,
      nativePostId,
      nativeUrl: postUrl(uri),
      body: string(postRecord.text) ?? "",
      createdAt: string(postRecord.createdAt),
      author: {
        id: string(record(view.author).did),
        name: string(record(view.author).displayName),
        username: string(record(view.author).handle),
        avatarUrl: string(record(view.author).avatar),
      },
      likeCount: number(view.likeCount),
      replyCount: number(view.replyCount),
      kind: "reply",
      canReply: validCid(cid) && validCid(preservedRootCid),
      canLike: validCid(cid),
      liked: Boolean(record(view.viewer).like),
      replyTarget:
        cid && validCid(preservedRootCid)
          ? { rootUri: preservedRootUri, rootCid: preservedRootCid, parentUri: uri, parentCid: cid }
          : undefined,
    };
  }

  async listPostComments(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    const uri = bskyUri(post);
    if (!uri) return invalidRequest(this.platform, "the Bluesky post URI is invalid.");
    if (options.cursor)
      return invalidRequest(this.platform, "Bluesky thread views do not expose a continuation cursor.");
    const url = this.url(account, "xrpc/app.bsky.feed.getPostThread", {
      uri,
      depth: String(MAX_THREAD_COMMENTS),
      parentHeight: String(MAX_THREAD_COMMENTS),
    });
    if (!url) return invalidRequest(this.platform, "the Bluesky PDS URL is invalid.");
    const response = await this.request(account, url);
    if (!response.result.ok) return response.result;
    const root = record(response.result.data.thread);
    const rootView = record(root.post);
    const rootUri = string(rootView.uri);
    const rootCid = string(rootView.cid);
    if (!rootUri || !AT_URI.test(rootUri) || !validCid(rootCid)) return invalidResponse(this.platform);
    const comments: SocialComment[] = [];
    const maximum = Math.min(pageLimit(options.limit), MAX_THREAD_COMMENTS);
    const visit = (node: unknown): void => {
      if (comments.length >= maximum) return;
      const item = record(node);
      const mapped = this.activity(record(item.post), post.nativePostId, rootUri, rootCid);
      if (mapped && mapped.nativeId !== rootUri) comments.push(mapped);
      for (const reply of Array.isArray(item.replies) ? item.replies : []) visit(reply);
    };
    for (const reply of Array.isArray(root.replies) ? root.replies : []) visit(reply);
    return {
      ok: true as const,
      data: page(
        comments,
        undefined,
        `Bluesky returns a bounded thread view (up to ${MAX_THREAD_COMMENTS} levels/items); deeper replies may be omitted.`,
      ),
    };
  }

  async listPostQuotes(
    account: SocialActivityAccount,
    post: SocialActivityPostTarget,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<SocialActivityResult<SocialActivityPage<SocialComment>>> {
    const uri = bskyUri(post);
    const cursor = safeCursor(options.cursor);
    if (!uri || (options.cursor && !cursor)) return invalidRequest(this.platform, "the post URI or cursor is invalid.");
    const url = this.url(account, "xrpc/app.bsky.feed.getQuotes", {
      uri,
      limit: String(pageLimit(options.limit)),
      ...(cursor ? { cursor } : {}),
    });
    if (!url) return invalidRequest(this.platform, "the Bluesky PDS URL is invalid.");
    const { result } = await this.request(account, url);
    if (!result.ok) return result;
    if (!Array.isArray(result.data.posts)) return invalidResponse(this.platform);
    return {
      ok: true,
      data: page(
        result.data.posts.flatMap((entry) => {
          const view = record(entry);
          const itemUri = string(view.uri);
          if (!itemUri) return [];
          const item = this.activity(view, uri, itemUri, string(view.cid));
          return item ? [{ ...item, kind: "quote" as const }] : [];
        }),
        string(result.data.cursor),
      ),
    };
  }

  async likeItem({ account, target }: SocialLikeRequest): Promise<SocialActivityResult<SocialLike>> {
    const uri = target.nativeId;
    if (!DID.test(account.platformAccountId) || !AT_URI.test(uri))
      return invalidRequest(this.platform, "the Bluesky account or post is invalid.");
    const lookup = this.url(account, "xrpc/app.bsky.feed.getPosts", { uris: uri });
    const write = this.url(account, "xrpc/com.atproto.repo.putRecord");
    if (!lookup || !write) return invalidRequest(this.platform, "the Bluesky PDS URL is invalid.");
    const current = await this.request(account, lookup);
    if (!current.result.ok) return current.result;
    const posts = current.result.data.posts;
    const post = Array.isArray(posts)
      ? posts.map((entry) => record(entry)).find((entry) => entry.uri === uri)
      : undefined;
    const cid = string(post?.cid);
    if (!validCid(cid)) return invalidRequest(this.platform, "the Bluesky post is no longer available.");
    if (record(post?.viewer).like) return { ok: true, data: { liked: true } };
    const response = await this.request(account, write, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: account.platformAccountId,
        collection: "app.bsky.feed.like",
        rkey: `simplepost-${createHash("sha256").update(uri).digest("hex")}`,
        record: { $type: "app.bsky.feed.like", subject: { uri, cid }, createdAt: new Date().toISOString() },
      }),
    });
    if (!response.result.ok) return response.result;
    return string(response.result.data.uri) ? { ok: true, data: { liked: true } } : uncertainWrite(this.platform);
  }

  async replyToComment(request: SocialReplyRequest): Promise<SocialActivityResult<SocialReply>> {
    if (!DID.test(request.account.platformAccountId))
      return invalidRequest(this.platform, "the Bluesky account DID is invalid.");
    const text = trimmedReply(this.platform, request.text, 300);
    if (typeof text !== "string") return text;
    const target = record(request.target.replyTarget);
    const rootUri = string(target.rootUri);
    const rootCid = string(target.rootCid);
    const parentUri = string(target.parentUri) ?? request.target.nativeId;
    const parentCid = string(target.parentCid);
    if (!rootUri || !AT_URI.test(rootUri) || !validCid(rootCid) || !AT_URI.test(parentUri) || !validCid(parentCid))
      return invalidRequest(this.platform, "the Bluesky reply context is unavailable. Refresh the conversation first.");
    const url = this.url(request.account, "xrpc/com.atproto.repo.createRecord");
    if (!url) return invalidRequest(this.platform, "the Bluesky PDS URL is invalid.");
    const response = await this.request(request.account, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: request.account.platformAccountId,
        collection: "app.bsky.feed.post",
        record: {
          $type: "app.bsky.feed.post",
          text,
          createdAt: new Date().toISOString(),
          reply: { root: { uri: rootUri, cid: rootCid }, parent: { uri: parentUri, cid: parentCid } },
        },
      }),
    });
    if (!response.result.ok) return response.result;
    const uri = string(response.result.data.uri);
    return uri && AT_URI.test(uri)
      ? { ok: true as const, data: { nativeId: uri, nativeUrl: postUrl(uri), createdAt: new Date().toISOString() } }
      : uncertainReply<SocialReply>(this.platform);
  }
}
