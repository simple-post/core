import fs from "node:fs";

import axios from "axios";

import { LinkedInPublisher } from "../src/publishers/linkedin";
import { LinkedInOptionsSchema } from "../src/types/post";
import { getCredentialsFromEnv } from "../src/utils/credentials";
import { validateContentForPlatform } from "../src/validation";

jest.mock("axios");
jest.mock("node:fs");
jest.mock("node:timers/promises", () => ({ setTimeout: () => Promise.resolve() }));

const http = axios as jest.Mocked<typeof axios>;
const files = fs as jest.Mocked<typeof fs>;
const credentials = { accessToken: "token", organizationId: "123" };
const destroy = jest.fn();
const image = { type: "image" as const, path: "/image.jpg", caption: "Company logo" };
const video = { type: "video" as const, path: "/video.mp4", title: "Demo" };
const create = () => new LinkedInPublisher({ linkedin: { credentials } });
const postResponse = { data: {}, headers: { "x-restli-id": "urn:li:share:456" } };

beforeEach(() => {
  jest.resetAllMocks();
  http.create.mockReturnValue({ post: jest.fn() } as any);
  files.existsSync.mockReturnValue(true);
  files.statSync.mockReturnValue({ size: 10 } as any);
  files.createReadStream.mockReturnValue({ destroy } as any);
  http.put.mockResolvedValue({ headers: { etag: '"part-1"' } });
  http.get.mockResolvedValue({ data: { status: "AVAILABLE" } });
  http.isAxiosError.mockImplementation((error): error is any => Boolean(error?.isAxiosError));
});

it("posts text as an organization using the versioned Posts API", async () => {
  http.post.mockResolvedValue(postResponse);
  await expect(create().postContent({ text: "Company news" })).resolves.toMatchObject({ id: "urn:li:share:456" });
  expect(http.post).toHaveBeenCalledWith(
    "https://api.linkedin.com/rest/posts",
    expect.objectContaining({
      author: "urn:li:organization:123",
      commentary: "Company news",
      visibility: "PUBLIC",
    }),
    expect.objectContaining({ headers: expect.objectContaining({ "Linkedin-Version": "202606" }) }),
  );
});

it("escapes punctuation in Page commentary without losing text", async () => {
  http.post.mockResolvedValue(postResponse);
  await create().postContent({ text: "News (v2) | [beta] @team #launch" });
  expect(http.post).toHaveBeenCalledWith(
    expect.stringContaining("/posts"),
    expect.objectContaining({ commentary: String.raw`News \(v2\) \| \[beta\] \@team \#launch` }),
    expect.anything(),
  );
});

it("rejects non-public Page visibility during preflight validation", () => {
  const result = validateContentForPlatform(
    "linkedin",
    { text: "News" },
    { linkedin: { credentials, visibility: "CONNECTIONS" } },
  );
  expect(result.isValid).toBe(false);
  expect(result.errors).toContainEqual(expect.objectContaining({ code: "linkedin_page_visibility" }));
});

it.each([1, 2])("uploads %i images owned by the Page and waits for processing", async (count) => {
  http.post.mockImplementation(async (url) =>
    url.includes("initializeUpload")
      ? { data: { value: { image: "urn:li:image:abc", uploadUrl: "https://www.linkedin.com/upload" } } }
      : postResponse,
  );
  http.get
    .mockResolvedValueOnce({ data: { status: "PROCESSING" } })
    .mockResolvedValue({ data: { status: "AVAILABLE" } });
  await create().postContent({ text: "Photo", media: Array.from({ length: count }, () => image) });
  expect(http.post).toHaveBeenCalledWith(
    expect.stringContaining("images?action=initializeUpload"),
    {
      initializeUploadRequest: { owner: "urn:li:organization:123" },
    },
    expect.anything(),
  );
  const expected = { id: "urn:li:image:abc", altText: "Company logo" };
  expect(http.post).toHaveBeenLastCalledWith(
    expect.stringContaining("/posts"),
    expect.objectContaining({
      content: count === 1 ? { media: expected } : { multiImage: { images: [expected, expected] } },
    }),
    expect.anything(),
  );
  expect(http.get).toHaveBeenCalledTimes(count + 1);
  expect(destroy).toHaveBeenCalledTimes(count);
});

it("streams the exact multipart video ranges and finalizes with ordered ETags", async () => {
  http.post
    .mockResolvedValueOnce({
      data: {
        value: {
          video: "urn:li:video:abc",
          uploadToken: "",
          uploadInstructions: [
            { uploadUrl: "https://www.linkedin.com/1", firstByte: 0, lastByte: 5 },
            { uploadUrl: "https://www.linkedin.com/2", firstByte: 6, lastByte: 9 },
          ],
        },
      },
    })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(postResponse);
  http.put.mockResolvedValueOnce({ headers: { etag: '"one"' } }).mockResolvedValueOnce({ headers: { etag: '"two"' } });
  await create().postContent({ media: [video] });
  expect(files.createReadStream).toHaveBeenNthCalledWith(1, "/video.mp4", { start: 0, end: 5 });
  expect(files.createReadStream).toHaveBeenNthCalledWith(2, "/video.mp4", { start: 6, end: 9 });
  expect(http.put.mock.calls.map((call) => call[2]?.headers?.["Content-Length"])).toEqual([6, 4]);
  expect(http.post).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("finalizeUpload"),
    {
      finalizeUploadRequest: { video: "urn:li:video:abc", uploadToken: "", uploadedPartIds: ["one", "two"] },
    },
    expect.anything(),
  );
  expect(http.post).toHaveBeenLastCalledWith(
    expect.stringContaining("/posts"),
    expect.objectContaining({ content: { media: { id: "urn:li:video:abc", title: "Demo" } } }),
    expect.anything(),
  );
});

it.each(["PROCESSING_FAILED", "PROCESSING"])("does not create a post when media stays %s", async (status) => {
  http.post.mockResolvedValue({
    data: { value: { image: "urn:li:image:abc", uploadUrl: "https://www.linkedin.com/upload" } },
  });
  http.get.mockResolvedValue({ data: { status } });
  await expect(create().postContent({ media: [image] })).rejects.toThrow(/processing (failed|timed out)/);
  expect(http.post).toHaveBeenCalledTimes(1);
});

it("rejects incomplete upload ranges before transmitting video", async () => {
  http.post.mockResolvedValue({
    data: {
      value: {
        video: "urn:li:video:abc",
        uploadToken: "",
        uploadInstructions: [{ uploadUrl: "https://www.linkedin.com/1", firstByte: 0, lastByte: 8 }],
      },
    },
  });
  await expect(create().postContent({ media: [video] })).rejects.toThrow("entire file");
  expect(http.put).not.toHaveBeenCalled();
});

it("does not finalize a video without upload ETags", async () => {
  http.post.mockResolvedValue({
    data: {
      value: {
        video: "urn:li:video:abc",
        uploadToken: "",
        uploadInstructions: [{ uploadUrl: "https://www.linkedin.com/1", firstByte: 0, lastByte: 9 }],
      },
    },
  });
  http.put.mockResolvedValue({ headers: {} });
  await expect(create().postContent({ media: [video] })).rejects.toThrow("ETag");
  expect(http.post).toHaveBeenCalledTimes(1);
  expect(destroy).toHaveBeenCalled();
});

it("never sends a bearer token to an unsupported upload host", async () => {
  http.post.mockResolvedValue({
    data: { value: { image: "urn:li:image:abc", uploadUrl: "https://example.com/upload" } },
  });
  await expect(create().postContent({ media: [image] })).rejects.toThrow("unsupported media upload URL");
  expect(http.put).not.toHaveBeenCalled();
});

it.each([401, 403])("gives reconnect guidance on HTTP %i without falling back to a person", async (status) => {
  http.post.mockRejectedValue({ isAxiosError: true, response: { status } });
  await expect(create().postContent({ text: "News" })).rejects.toThrow("Reconnect with a Page admin account");
  expect(http.post).toHaveBeenCalledTimes(1);
});

it("rejects connections-only Page posts and reshares before any HTTP request", async () => {
  const options = { linkedin: { credentials, visibility: "CONNECTIONS" as const } };
  await expect(create().postContent({ text: "News" }, options)).rejects.toThrow("PUBLIC visibility");
  await expect(create().repostContent({ postId: "urn:li:share:1" }, options)).rejects.toThrow("PUBLIC visibility");
  expect(http.post).not.toHaveBeenCalled();
});

it("uses the organization as author for quotes and reposts", async () => {
  http.post.mockResolvedValue(postResponse);
  await create().quoteContent({ text: "Our take" }, { postId: "urn:li:share:1" });
  await create().repostContent({ postId: "urn:li:share:2" });
  expect(http.post.mock.calls.map((call) => (call[1] as { author: string }).author)).toEqual([
    "urn:li:organization:123",
    "urn:li:organization:123",
  ]);
});

it("requires exactly one destination and keeps member credentials compatible", () => {
  expect(LinkedInOptionsSchema.safeParse({ credentials }).success).toBe(true);
  expect(LinkedInOptionsSchema.safeParse({ credentials: { accessToken: "t", memberId: "member" } }).success).toBe(true);
  for (const identity of [
    {},
    { memberId: "member", organizationId: "123" },
    { organizationId: "urn:li:organization:123" },
  ]) {
    expect(LinkedInOptionsSchema.safeParse({ credentials: { accessToken: "t", ...identity } }).success).toBe(false);
    expect(() => new LinkedInPublisher({ linkedin: { credentials: { accessToken: "t", ...identity } } })).toThrow();
  }
});

it("loads organization credentials from the environment without requiring a member ID", () => {
  const previous = { ...process.env };
  try {
    process.env.LINKEDIN_ACCESS_TOKEN = "token";
    process.env.LINKEDIN_ORGANIZATION_ID = "123";
    delete process.env.LINKEDIN_MEMBER_ID;
    expect(getCredentialsFromEnv().linkedin?.credentials).toEqual({ ...credentials, memberId: undefined });
  } finally {
    process.env = previous;
  }
});
