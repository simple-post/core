import crypto from "node:crypto";

import axios from "axios";

import {
  getSocialActivityCapabilities,
  getSocialActivityProvider,
  getSocialPostMetrics,
  listSocialMentions,
  listSocialPostComments,
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
    expect(getSocialActivityCapabilities("linkedin")).toEqual(new Set(["metrics", "comments", "replies"]));
    expect(getSocialActivityCapabilities("forem")).toEqual(new Set(["metrics", "comments"]));
    expect(getSocialActivityCapabilities("telegram")).toEqual(new Set());

    const result = await listSocialMentions(account("forem"));
    expect(result).toMatchObject({ ok: false, error: { code: "unsupported" } });
  });

  it("reads Forem article counters and paged id_code comment trees without exposing a reply capability", async () => {
    const get = jest
      .spyOn(axios, "get")
      .mockResolvedValueOnce({ status: 200, data: { id: 123, positive_reactions_count: 5, comments_count: 2 } })
      .mockResolvedValueOnce({
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
    const metrics = await getSocialPostMetrics(forem, post("123"));
    expect(metrics).toMatchObject({ ok: true, data: { values: { positive_reactions_count: 5, comments_count: 2 } } });
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
    expect(get.mock.calls[1][0]).toBe("https://dev.to/api/comments?a_id=123&page=1&per_page=1");
    get.mockRestore();
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

  it("maps Facebook basic counters without legacy insight fields and retains them when optional insights fail", async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          reactions: { summary: { total_count: 3 } },
          comments: { summary: { total_count: 2 } },
          shares: { count: 1 },
        }),
      )
      .mockResolvedValueOnce(json({ error: { code: 400 } }, 400));

    const result = await getSocialPostMetrics(account("facebook"), post("1_2"));
    expect(result).toMatchObject({ ok: true, data: { values: { reactions: 3, comments: 2, shares: 1 } } });
    const fields = new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("fields");
    expect(fields).not.toContain("post_impressions");
    expect(fields).not.toContain("post_engaged_users");
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

  it("parses Threads total_value metrics and marks a publish with no ID as uncertain", async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [{ name: "views", total_value: { value: 42 } }] }));
    const metrics = await getSocialPostMetrics(account("threads"), post("123"));
    expect(metrics).toMatchObject({ ok: true, data: { values: { views: 42 } } });

    fetchMock.mockResolvedValueOnce(json({ id: "987" })).mockResolvedValueOnce(json({}));
    const reply = await replyToSocialComment({
      account: account("threads", "456"),
      target: { nativeId: "789", nativePostId: "123", body: "hello", canReply: true },
      text: "A reply",
    });
    expect(reply).toMatchObject({ ok: false, error: { code: "uncertain" } });
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

  it("queries TikTok video/query by public video ID and normalizes its HTTP 200 scope error", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { code: "scope_not_authorized" } }));
    const denied = await getSocialPostMetrics(account("tiktok"), post("1234567890123456789"));
    expect(denied).toMatchObject({ ok: false, error: { code: "permission_required" } });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({ filters: { video_ids: ["1234567890123456789"] } });

    const photo = await getSocialPostMetrics(account("tiktok"), post("1234567890123456789", { mediaType: "photo" }));
    expect(photo).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });

  it("uses Pinterest ALL summary metrics and declares the 90-day coverage", async () => {
    fetchMock.mockResolvedValueOnce(json({ all: { summary_metrics: { IMPRESSION: 12, SAVE: 2 } } }));
    const result = await getSocialPostMetrics(account("pinterest"), {
      ...post("pin_1"),
      publishedAt: "2020-01-01T00:00:00Z",
    });
    expect(result).toMatchObject({
      ok: true,
      data: { values: { IMPRESSION: 12, SAVE: 2 }, coverage: expect.stringContaining("90 days") },
    });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("metric_types")).toBe("ALL");
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
    const result = await getSocialPostMetrics(bskyAccount, post("at://did:plc:alice/app.bsky.feed.post/3kabc"));
    expect(result).toMatchObject({ ok: true, data: { values: { likeCount: 3 } } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const headers = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(headers["atproto-proxy"]).toBe("did:web:api.bsky.app#bsky_appview");
    const proof = headers.DPoP.split(".")[1];
    const payload = JSON.parse(Buffer.from(proof, "base64url").toString("utf8"));
    expect(payload).toMatchObject({ nonce: "challenge", htu: "https://bsky.social/xrpc/app.bsky.feed.getPosts" });
  });

  it("uses LinkedIn lifetime entity analytics with tagged metric types and documented social-action comments", async () => {
    for (const name of ["IMPRESSION", "MEMBERS_REACHED", "REACTION", "RESHARE", "COMMENT"]) {
      fetchMock.mockResolvedValueOnce(json({ elements: [{ metricType: { "com.linkedin.example": name }, count: 7 }] }));
    }
    const linkedInPost = post("urn:li:share:123");
    const metrics = await getSocialPostMetrics(account("linkedin", "member"), linkedInPost);
    expect(metrics).toMatchObject({ ok: true, data: { values: { IMPRESSION: 7, COMMENT: 7 } } });
    const analytics = new URL(String(fetchMock.mock.calls[0][0]));
    expect(analytics.pathname).toBe("/rest/memberCreatorPostAnalytics");
    expect(analytics.searchParams.get("entity")).toBe("(share:urn:li:share:123)");
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "Linkedin-Version": "202606" });

    fetchMock.mockResolvedValueOnce(
      json({
        elements: [
          {
            id: "6636062862760562688",
            commentUrn: "urn:li:comment:(urn:li:activity:6631349431612559360,6636062862760562688)",
            object: "urn:li:activity:6631349431612559360",
            actor: "urn:li:person:alice",
            message: { text: "Official schema fixture" },
            created: { time: 1_582_160_678_569 },
          },
        ],
      }),
    );
    const comments = await listSocialPostComments(account("linkedin", "member"), linkedInPost);
    expect(comments).toMatchObject({
      ok: true,
      data: { data: [{ nativeId: "6636062862760562688", body: "Official schema fixture" }] },
    });
  });
});
