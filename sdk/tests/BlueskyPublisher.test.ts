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

  beforeEach(() => {
    jest.clearAllMocks();

    mockAxiosInstance = {
      post: jest.fn(),
    };
    mockedAxios.create.mockReturnValue(mockAxiosInstance);

    mockedFs.existsSync.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(Buffer.from("mock file"));

    publisher = new BlueskyPublisher({
      bluesky: {
        credentials: {
          accessToken: "test_access_token",
          did: "did:plc:123",
          pdsUrl: "https://bsky.social",
        },
      },
    });
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
  });

  describe("app password mode", () => {
    const makeJwt = (expiresInSeconds: number): string => {
      const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expiresInSeconds }),
      ).toString("base64url");
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
