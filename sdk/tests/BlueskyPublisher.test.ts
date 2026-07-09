import fs from "node:fs";

import axios from "axios";

import { BlueskyPublisher } from "../src/publishers/bluesky";
import { PostError, PostErrorType } from "../src/types";

import type { Content } from "../src/types/post";

jest.mock("axios");
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedFs = fs as jest.Mocked<typeof fs>;

describe("BlueskyPublisher", () => {
  let publisher: BlueskyPublisher;
  let mockAxiosInstance: any;

  const makeOAuthPublisher = (credentials: Record<string, unknown> = {}) =>
    new BlueskyPublisher({
      bluesky: {
        credentials: {
          accessToken: "test_access_token",
          did: "did:plc:123",
          pdsUrl: "https://bsky.social",
          ...credentials,
        },
      },
    });

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(Buffer.from("mock file"));

    publisher = makeOAuthPublisher();
  });

  describe("constructor", () => {
    it("should throw an error if credentials are missing", () => {
      expect(() => new BlueskyPublisher()).toThrow(PostError);
    });

    it("should throw if OAuth credentials are missing pdsUrl", () => {
      expect(
        () =>
          new BlueskyPublisher({
            bluesky: {
              credentials: {
                accessToken: "tok",
                did: "did:plc:123",
              } as never,
            },
          }),
      ).toThrow(PostError);
    });

    it("should accept app password credentials without pdsUrl", () => {
      expect(
        () =>
          new BlueskyPublisher({
            bluesky: {
              credentials: {
                identifier: "alice.bsky.social",
                appPassword: "abcd-efgh-ijkl-mnop",
              },
            },
          }),
      ).not.toThrow();
    });
  });

  describe("postContent", () => {
    it("should post text and image successfully", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            blob: {
              $type: "blob",
              ref: { $link: "blob_ref" },
              mimeType: "image/jpeg",
              size: 1234,
            },
          },
        })
        .mockResolvedValueOnce({
          data: { uri: "at://did:plc:123/app.bsky.feed.post/abc" },
        });

      const content: Content = {
        text: "Hello Bluesky!",
        media: [{ type: "image", path: "./test.jpg" }],
      };

      const result = await publisher.postContent(content);

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("at://did:plc:123/app.bsky.feed.post/abc");
      expect(mockAxiosInstance.post).toHaveBeenCalledTimes(2);
    });

    it("should reject video content", async () => {
      const content: Content = {
        text: "Video not supported",
        media: [{ type: "video", path: "./video.mp4" }],
      };

      await expect(publisher.postContent(content)).rejects.toThrow(PostError);
    });

    it("should proactively refresh expired OAuth credentials before posting", async () => {
      const expiresAt = Math.floor(Date.now() / 1000) - 60;
      publisher = makeOAuthPublisher({
        accessToken: "expired_access_token",
        refreshToken: "refresh_token",
        expiresAt,
        tokenUrl: "https://bsky.social/oauth/token",
        clientId: "client_id",
      });

      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: "new_access_token", refresh_token: "new_refresh_token", expires_in: 3600 },
      });
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { uri: "at://did:plc:123/app.bsky.feed.post/refreshed" },
      });

      const result = await publisher.postContent({ text: "Hello after refresh" });

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://bsky.social/oauth/token",
        expect.any(URLSearchParams),
        expect.objectContaining({
          headers: expect.objectContaining({ "Content-Type": "application/x-www-form-urlencoded" }),
        }),
      );
      expect(mockAxiosInstance.post.mock.calls[0][2].headers.Authorization).toBe("Bearer new_access_token");
      expect(result.extraData?.refreshedCredentials).toMatchObject({
        accessToken: "new_access_token",
        refreshToken: "new_refresh_token",
        expiresAt: expect.any(Number),
      });
    });

    it("should retry Bluesky OAuth refresh when the token endpoint returns a DPoP nonce challenge", async () => {
      const expiresAt = Math.floor(Date.now() / 1000) - 60;
      publisher = makeOAuthPublisher({
        accessToken: "expired_access_token",
        refreshToken: "refresh_token",
        expiresAt,
        tokenUrl: "https://bsky.social/oauth/token",
        clientId: "client_id",
      });

      mockedAxios.post
        .mockRejectedValueOnce({
          response: {
            status: 400,
            headers: { "dpop-nonce": "fresh_nonce" },
            data: { error: "use_dpop_nonce" },
          },
          message: "Request failed",
        })
        .mockResolvedValueOnce({
          data: { access_token: "new_access_token", refresh_token: "new_refresh_token", expires_in: 3600 },
        });
      mockAxiosInstance.post.mockResolvedValueOnce({
        data: { uri: "at://did:plc:123/app.bsky.feed.post/refreshed" },
      });

      const result = await publisher.postContent({ text: "Hello after nonce refresh" });

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(result.extraData?.refreshedCredentials).toMatchObject({
        accessToken: "new_access_token",
        refreshToken: "new_refresh_token",
        expiresAt: expect.any(Number),
      });
    });

    it("should refresh and retry when Bluesky rejects a stale token", async () => {
      publisher = makeOAuthPublisher({
        accessToken: "stale_access_token",
        refreshToken: "refresh_token",
        tokenUrl: "https://bsky.social/oauth/token",
        clientId: "client_id",
      });

      mockAxiosInstance.post
        .mockRejectedValueOnce({
          response: { status: 401, data: { error: "ExpiredToken", message: "Token has expired" } },
          message: "Request failed",
        })
        .mockResolvedValueOnce({
          data: { uri: "at://did:plc:123/app.bsky.feed.post/retried" },
        });
      mockedAxios.post.mockResolvedValueOnce({
        data: { access_token: "retry_access_token", refresh_token: "retry_refresh_token", expires_in: 3600 },
      });

      const result = await publisher.postContent({ text: "Hello after retry" });

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockAxiosInstance.post.mock.calls[0][2].headers.Authorization).toBe("Bearer stale_access_token");
      expect(mockAxiosInstance.post.mock.calls[1][2].headers.Authorization).toBe("Bearer retry_access_token");
      expect(result.extraData?.refreshedCredentials).toMatchObject({
        accessToken: "retry_access_token",
        refreshToken: "retry_refresh_token",
        expiresAt: expect.any(Number),
      });
    });

    it("should create a quote post with a record-with-media embed", async () => {
      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: {
            blob: {
              $type: "blob",
              ref: { $link: "blob_ref" },
              mimeType: "image/jpeg",
              size: 1234,
            },
          },
        })
        .mockResolvedValueOnce({
          data: { uri: "at://did:plc:123/app.bsky.feed.post/quote", cid: "quote-cid" },
        });

      const result = await publisher.quote(
        { text: "My take", media: [{ type: "image", path: "./test.jpg" }] },
        { postId: "source", uri: "at://did:plc:source/app.bsky.feed.post/source", cid: "source-cid" },
      );

      const createRecordBody = mockAxiosInstance.post.mock.calls[1][1];
      expect(createRecordBody.record.embed).toEqual({
        $type: "app.bsky.embed.recordWithMedia",
        record: {
          $type: "app.bsky.embed.record",
          record: { uri: "at://did:plc:source/app.bsky.feed.post/source", cid: "source-cid" },
        },
        media: expect.objectContaining({ $type: "app.bsky.embed.images" }),
      });
      expect(result).toMatchObject({ id: "at://did:plc:123/app.bsky.feed.post/quote", error: PostErrorType.NO_ERROR });
    });

    it("should reject a quote target without the Bluesky uri/cid pair", async () => {
      const result = await publisher.quote({ text: "My take" }, { postId: "source" });

      expect(result).toMatchObject({
        error: PostErrorType.INVALID_CONTENT,
        message: "Bluesky quotes require both uri and cid for the target post.",
      });
      expect(mockAxiosInstance.post).not.toHaveBeenCalled();
    });
  });

  describe("app password mode", () => {
    const makeJwt = (expiresInSeconds: number): string => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds })).toString(
        "base64url",
      );
      return `${header}.${payload}.sig`;
    };

    it("should create a session and post using identifier + appPassword", async () => {
      const accessJwt = makeJwt(3600);
      const refreshJwt = makeJwt(7 * 24 * 3600);

      mockAxiosInstance.post
        .mockResolvedValueOnce({
          data: { accessJwt, refreshJwt, did: "did:plc:abc", handle: "alice.bsky.social" },
        })
        .mockResolvedValueOnce({
          data: { uri: "at://did:plc:abc/app.bsky.feed.post/xyz" },
        });

      const appPwPublisher = new BlueskyPublisher({
        bluesky: {
          credentials: {
            identifier: "alice.bsky.social",
            appPassword: "abcd-efgh-ijkl-mnop",
          },
        },
      });

      const result = await appPwPublisher.postContent({ text: "Hi from app password" });

      expect(result.error).toBe(PostErrorType.NO_ERROR);
      expect(result.id).toBe("at://did:plc:abc/app.bsky.feed.post/xyz");

      const calls = mockAxiosInstance.post.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toBe("/xrpc/com.atproto.server.createSession");
      expect(calls[0][1]).toEqual({
        identifier: "alice.bsky.social",
        password: "abcd-efgh-ijkl-mnop",
      });
      expect(calls[1][0]).toBe("/xrpc/com.atproto.repo.createRecord");
      expect(calls[1][2].headers.Authorization).toBe(`Bearer ${accessJwt}`);
      expect(calls[1][2].headers.DPoP).toBeUndefined();
      expect(result.extraData?.refreshedCredentials).toBeUndefined();
    });

    it("should reuse the session across multiple posts within one publisher instance", async () => {
      const accessJwt = makeJwt(3600);
      const refreshJwt = makeJwt(7 * 24 * 3600);

      mockAxiosInstance.post
        .mockResolvedValueOnce({ data: { accessJwt, refreshJwt, did: "did:plc:abc" } })
        .mockResolvedValueOnce({ data: { uri: "at://did:plc:abc/app.bsky.feed.post/1" } })
        .mockResolvedValueOnce({ data: { uri: "at://did:plc:abc/app.bsky.feed.post/2" } });

      const appPwPublisher = new BlueskyPublisher({
        bluesky: {
          credentials: {
            identifier: "alice.bsky.social",
            appPassword: "abcd-efgh-ijkl-mnop",
          },
        },
      });

      await appPwPublisher.postContent({ text: "First" });
      await appPwPublisher.postContent({ text: "Second" });

      const calls = mockAxiosInstance.post.mock.calls;
      expect(calls).toHaveLength(3);
      expect(calls[0][0]).toBe("/xrpc/com.atproto.server.createSession");
      expect(calls[1][0]).toBe("/xrpc/com.atproto.repo.createRecord");
      expect(calls[2][0]).toBe("/xrpc/com.atproto.repo.createRecord");
    });

    it("should throw CREDENTIALS_ERROR when createSession fails", async () => {
      mockAxiosInstance.post.mockRejectedValueOnce({
        response: { status: 401, data: { error: "AuthenticationRequired", message: "Invalid identifier or password" } },
        message: "Request failed",
      });

      const appPwPublisher = new BlueskyPublisher({
        bluesky: {
          credentials: {
            identifier: "alice.bsky.social",
            appPassword: "wrong",
          },
        },
      });

      await expect(appPwPublisher.postContent({ text: "won't post" })).rejects.toMatchObject({
        errorType: PostErrorType.CREDENTIALS_ERROR,
      });
    });
  });
});
