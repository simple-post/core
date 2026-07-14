import dns from "node:dns";

import axios from "axios";

import { ForemPublisher } from "../src/publishers/forem";
import { normalizeForemInstanceUrl, validateForemRedirect } from "../src/publishers/forem/security";
import { PostErrorType } from "../src/types";
jest.mock("axios");
const mocked = axios as jest.Mocked<typeof axios>;
const options = { forem: { credentials: { instanceUrl: "https://dev.to", apiKey: "key" } } } as const;
describe("ForemPublisher", () => {
  beforeEach(() => jest.clearAllMocks());
  it("creates an article with v1 headers", async () => {
    mocked.post.mockResolvedValue({ data: { id: 1, url: "https://dev.to/user/post" } });
    const result = await new ForemPublisher(options).postContent({ text: "# Hello\nBody" }, options);
    expect(mocked.post).toHaveBeenCalledWith(
      "https://dev.to/api/articles",
      expect.objectContaining({ article: expect.objectContaining({ title: "Hello", published: true }) }),
      expect.objectContaining({
        headers: expect.objectContaining({ "api-key": "key" }),
        lookup: expect.any(Function),
        beforeRedirect: expect.any(Function),
      }),
    );
    expect(result.error).toBe(PostErrorType.NO_ERROR);
  });
  it("requires URL media", () =>
    expect(ForemPublisher.validate({ media: [{ type: "image", path: "x" }] }).isValid).toBe(false));

  it.each([
    "http://dev.to",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://169.254.169.254",
    "https://metadata.google.internal",
    "https://dev.to/some-path",
    "https://user:password@dev.to",
  ])("rejects unsafe instance URL %s", async (instanceUrl) => {
    const unsafeOptions = { forem: { credentials: { instanceUrl, apiKey: "key" } } } as const;
    await expect(new ForemPublisher(unsafeOptions).postContent({ text: "hello" }, unsafeOptions)).rejects.toThrow();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it("normalizes public HTTPS origins and rejects unsafe redirect origins", () => {
    expect(normalizeForemInstanceUrl("https://community.example:8443/")).toBe("https://community.example:8443");
    expect(() => validateForemRedirect({ href: "https://127.0.0.1/api/articles" }, "https://dev.to")).toThrow(
      "private networks",
    );
    expect(() => validateForemRedirect({ href: "https://other.example/api/articles" }, "https://dev.to")).toThrow(
      "configured instance origin",
    );
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    mocked.post.mockImplementation(async (_url, _body, config) => {
      const lookup = config?.lookup as NonNullable<typeof config>["lookup"];
      const lookupSpy = jest.spyOn(dns, "lookup").mockImplementation(((_hostname, _options, callback) => {
        (callback as unknown as (error: null, addresses: Array<{ address: string; family: number }>) => void)(null, [
          { address: "169.254.169.254", family: 4 },
        ]);
      }) as typeof dns.lookup);
      try {
        await new Promise<void>((resolve, reject) => {
          lookup?.("community.example", {}, (error) => (error ? reject(error) : resolve()));
        });
      } finally {
        lookupSpy.mockRestore();
      }
      return { data: { id: 1 } };
    });

    await expect(new ForemPublisher(options).postContent({ text: "hello" }, options)).rejects.toThrow(
      "private/internal",
    );
  });
});
