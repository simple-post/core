import crypto from "node:crypto";

import axios from "axios";

import {
  getSocialActivityCapabilities,
  getSocialActivityProvider,
  likeSocialItem,
  listSocialPostComments,
  listSocialPostQuotes,
  replyToSocialComment,
} from "../src";

import type { SocialActivityAccount, SocialActivityPostTarget } from "../src";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const account = (platform: string, platformAccountId = "1234567890123456789"): SocialActivityAccount => ({
  platform,
  accountId: `${platform}-connection`,
  platformAccountId,
  accessToken: "access-token",
});

const post = (nativePostId: string, platformData?: Record<string, unknown>): SocialActivityPostTarget => ({
  nativePostId,
  platformData,
});

describe("social activity adapters", () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it("dispatches supported providers and leaves v1 unsupported providers explicit", async () => {
    expect(getSocialActivityProvider("Twitter")?.platform).toBe("X");
    expect(getSocialActivityCapabilities("linkedin")).toEqual(new Set(["comments", "replies", "likes"]));
    expect(getSocialActivityCapabilities("forem")).toEqual(new Set(["comments"]));
    expect(getSocialActivityCapabilities("telegram")).toEqual(new Set());

    const result = await listSocialPostQuotes(account("forem"), post("123"));
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported" } });
  });

  it("reads Forem article comments and paged id_code comment trees without exposing a reply capability", async () => {
    const get = jest.spyOn(axios, "get").mockResolvedValueOnce({
      status: 200,
      data: [
        {
          id_code: "m3m0",
          body_html: "<p>Top &amp; welcome</p>",
          user: { name: "Ada", username: "ada" },
          children: [
            {
              id_code: "m3m1",
              body_html: "<p>Child <strong>reply</strong></p>",
              user: { name: "Ben", username: "ben" },
            },
          ],
        },
      ],
    });
    const forem = { ...account("forem"), credentials: { instanceUrl: "https://dev.to" } };
    const comments = await listSocialPostComments(forem, post("123"), { limit: 1 });
    expect(comments).toMatchObject({
      ok: true,
      data: {
        data: [
          { nativeId: "m3m0", body: "Top & welcome", nativeUrl: "https://dev.to/ada/comment/m3m0", canReply: false },
          { nativeId: "m3m1", body: "Child reply", nativeUrl: "https://dev.to/ben/comment/m3m1", canReply: false },
        ],
        nextCursor: "2",
        coverage: expect.stringContaining("Nested replies"),
      },
    });
    expect(get.mock.calls[0][0]).toBe("https://dev.to/api/comments?a_id=123&page=1&per_page=1");
    get.mockRestore();
  });

  it("distinguishes a Meta app restriction from an account that needs to reconnect", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: 10, message: "Application does not have permission for this action" } }, 403),
    );
    await expect(listSocialPostComments(account("threads"), post("200"))).resolves.toMatchObject({
      ok: false,
      error: { code: "app_permission_required", message: expect.stringContaining("app level") },
    });
  });

  it("resolves X thread segments to their root conversation and keeps empty search pages successful", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ data: { id: "200", conversation_id: "100" } }))
      .mockResolvedValueOnce(json({ data: [], meta: { result_count: 0 } }));

    const result = await listSocialPostComments(account("x"), post("200"));
    expect(result).toEqual({
      ok: true,
      data: {
        data: [],
        coverage: expect.stringContaining("root conversation"),
      },
    });
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("query")).toBe("conversation_id:100");
  });

  it("paginates X quotes and sends the like to the quoting post", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({ data: [{ id: "789", author_id: "678", text: "Quote" }], meta: { next_token: "next" } }),
      )
      .mockResolvedValueOnce(json({ data: { liked: true } }));
    const connection = account("x");
    const result = await listSocialPostQuotes(connection, post("111"), { cursor: "previous" });
    expect(result).toMatchObject({
      ok: true,
      data: { nextCursor: "next", data: [{ kind: "quote", nativeId: "789", nativePostId: "111" }] },
    });
    if (!result.ok) throw new Error("Missing quote");
    expect(await likeSocialItem({ account: connection, target: result.data.data[0] })).toEqual({
      ok: true,
      data: { liked: true },
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("tweets/111/quote_tweets?");
    expect(String(fetchMock.mock.calls[0][0])).toContain("pagination_token=previous");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ tweet_id: "789" });
  });

  it("lets Bluesky generate a valid like record key and skips an existing like", async () => {
    const connection = account("bluesky", "did:plc:owner");
    const uri = "at://did:plc:author/app.bsky.feed.post/3jzfcijpj2z2a";
    const cid = "bafyreigwnxqttkhzha2ig4io6wwht3qiugtor4ruglceyfdbnyq53a55fe";
    const likeUri = "at://did:plc:owner/app.bsky.feed.like/3msx2efqdxs27";
    const target = { nativeId: uri, nativePostId: uri, body: "", canReply: true, canLike: true };
    fetchMock
      .mockResolvedValueOnce(json({ posts: [{ uri, cid }] }))
      .mockImplementationOnce(async (url, options) => {
        const input = JSON.parse(String(options?.body));
        if (!String(url).endsWith("/com.atproto.repo.createRecord") || "rkey" in input)
          return json({ error: "InvalidRequest", message: "Invalid like record key" }, 400);
        return json({ uri: likeUri });
      })
      .mockResolvedValueOnce(json({ posts: [{ uri, cid, viewer: { like: likeUri } }] }));

    await expect(likeSocialItem({ account: connection, target })).resolves.toEqual({ ok: true, data: { liked: true } });
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      repo: connection.platformAccountId,
      collection: "app.bsky.feed.like",
      record: { $type: "app.bsky.feed.like", subject: { uri, cid }, createdAt: expect.any(String) },
    });
    await expect(likeSocialItem({ account: connection, target })).resolves.toEqual({ ok: true, data: { liked: true } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("uses Facebook's per-comment reply permission", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { id: "11", can_comment: false },
          { id: "12", can_comment: true, parent: { id: "11" } },
        ],
      }),
    );
    const result = await listSocialPostComments(account("facebook"), post("123_456"));
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("fields")?.split(",")).toContain("can_comment");
    expect(result).toMatchObject({
      ok: true,
      data: { data: [{ canReply: false }, { kind: "reply", canReply: true }] },
    });
  });

  it("continues a full LinkedIn page without a total and accepts a header-only reply receipt", async () => {
    const targetUrn = "urn:li:comment:(urn:li:activity:123,456)";
    const connection = account("linkedin");
    fetchMock
      .mockResolvedValueOnce(
        json({
          paging: { start: 0, count: 1 },
          elements: [{ id: "456", object: "urn:li:activity:123", commentUrn: targetUrn, message: { text: "hello" } }],
        }),
      )
      .mockResolvedValueOnce(json({ paging: { start: 1, count: 1 }, elements: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { "x-restli-id": "789" } }));
    const source = post("urn:li:share:123");
    const first = await listSocialPostComments(connection, source, { limit: 1 });
    if (!first.ok) throw new Error("Missing LinkedIn page");
    expect(first.data.nextCursor).toBe("1");
    const last = await listSocialPostComments(connection, source, { limit: 1, cursor: first.data.nextCursor });
    expect(last.ok && last.data.nextCursor).toBeUndefined();
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("start")).toBe("1");
    expect(
      await replyToSocialComment({ account: connection, target: first.data.data[0], text: "thanks" }),
    ).toMatchObject({ ok: true, data: { nativeId: "789" } });
  });

  it.each([
    [400, "badRequest", "invalid_request"],
    [403, "quotaExceeded", "rate_limited"],
  ])("classifies YouTube error %s/%s", async (status, reason, code) => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: status, errors: [{ reason }] } }, Number(status)));
    expect(await listSocialPostComments(account("youtube"), post("abcDEF_123"))).toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it("uses Instagram Login comment endpoints and replies to a nested comment through its parent", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          {
            id: "111",
            text: "Top level",
            replies: { data: [{ id: "222", text: "Nested" }] },
          },
        ],
        paging: { cursors: { after: "leaked-on-final-page" } },
      }),
    );
    const comments = await listSocialPostComments(account("instagram"), {
      ...post("999"),
      nativeUrl: "https://www.instagram.com/p/example/",
    });
    expect(comments).toMatchObject({ ok: true, data: { data: [{ nativeId: "111" }, { nativeId: "222" }] } });
    if (!comments.ok) throw new Error("expected comments");
    expect(comments.data.nextCursor).toBeUndefined();
    const nested = comments.data.data.find((value) => value.nativeId === "222");
    expect(nested?.replyTarget).toEqual({ instagramParentId: "111" });
    expect(nested?.nativeUrl).toBe("https://www.instagram.com/p/example/?comment_id=222");

    fetchMock.mockResolvedValueOnce(json({ id: "333" }));
    const reply = await replyToSocialComment({ account: account("instagram"), target: nested!, text: "Thanks" });
    expect(reply).toMatchObject({ ok: true, data: { nativeId: "333" } });
    expect(new URL(String(fetchMock.mock.calls[1][0])).pathname).toBe("/v25.0/111/replies");
  });

  it("recognizes a Threads quote reply when it quotes the tracked post", async () => {
    fetchMock.mockResolvedValueOnce(
      json({
        data: [
          { id: "101", text: "A reply" },
          { id: "102", text: "Quoting your post", is_quote_post: true, quoted_post: { id: "100" } },
          { id: "103", text: "Quoting another post", is_quote_post: true, quoted_post: "99" },
        ],
      }),
    );
    const result = await listSocialPostComments(account("threads"), post("100"));
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("fields")).toContain(
      "is_quote_post,quoted_post",
    );
    expect(result).toMatchObject({
      ok: true,
      data: {
        data: [
          { nativeId: "101", kind: "reply" },
          { nativeId: "102", kind: "quote", nativePostId: "100" },
          { nativeId: "103", kind: "reply" },
        ],
      },
    });
  });

  it("gets YouTube nested replies through comments.list and sends replies to the top-level comment", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          items: [
            {
              snippet: {
                canReply: false,
                totalReplyCount: 1,
                topLevelComment: {
                  id: "UgTop.ABC",
                  snippet: { textOriginal: "Top", publishedAt: "2026-01-01T00:00:00Z" },
                },
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json({
          items: [{ id: "UgChild.DEF", snippet: { textOriginal: "Child", publishedAt: "2026-01-01T00:01:00Z" } }],
        }),
      );
    const comments = await listSocialPostComments(account("youtube"), post("abcDEF_123"));
    expect(comments).toMatchObject({
      ok: true,
      data: { data: [{ nativeId: "UgTop.ABC" }, { nativeId: "UgChild.DEF", canReply: false }] },
    });
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("parentId")).toBe("UgTop.ABC");
    if (!comments.ok) throw new Error("expected comments");
    const child = comments.data.data.find((value) => value.nativeId === "UgChild.DEF")!;

    fetchMock.mockResolvedValueOnce(json({ id: "UgReply.GHI" }));
    const reply = await replyToSocialComment({ account: account("youtube"), target: child, text: "No auto reply" });
    expect(reply).toMatchObject({ ok: true, data: { nativeId: "UgReply.GHI" } });
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toMatchObject({ snippet: { parentId: "UgTop.ABC" } });
  });

  it("retries Bluesky DPoP once with a nonce, proxies appview reads, and uses a bsky.app visit URL", async () => {
    const pair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const privateJwk = pair.privateKey.export({ format: "jwk" }) as Record<string, unknown>;
    const publicJwk = pair.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
    const bskyAccount = {
      ...account("bluesky", "did:plc:alice"),
      credentials: { pdsUrl: "https://bsky.social", dpopPrivateJwk: privateJwk, dpopPublicJwk: publicJwk },
    };
    fetchMock
      .mockResolvedValueOnce(json({ error: "use_dpop_nonce" }, 400, { "DPoP-Nonce": "challenge" }))
      .mockResolvedValueOnce(
        json({
          posts: [
            {
              uri: "at://did:plc:alice/app.bsky.feed.post/3kabc",
              likeCount: 3,
              replyCount: 2,
              repostCount: 1,
              quoteCount: 0,
            },
          ],
        }),
      );
    const result = await listSocialPostQuotes(bskyAccount, post("at://did:plc:bob/app.bsky.feed.post/3k000"));
    expect(result).toMatchObject({
      ok: true,
      data: { data: [{ kind: "quote", nativeId: "at://did:plc:alice/app.bsky.feed.post/3kabc" }] },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(headers["atproto-proxy"]).toBe("did:web:api.bsky.app#bsky_appview");
    const proof = headers.DPoP.split(".")[1];
    const payload = JSON.parse(Buffer.from(proof, "base64url").toString("utf8"));
    expect(payload).toMatchObject({ nonce: "challenge", htu: "https://bsky.social/xrpc/app.bsky.feed.getQuotes" });
  });
});
