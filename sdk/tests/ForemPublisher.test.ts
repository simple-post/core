import axios from "axios";

import { ForemPublisher } from "../src/publishers/forem";
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
      expect.objectContaining({ headers: expect.objectContaining({ "api-key": "key" }) }),
    );
    expect(result.error).toBe(PostErrorType.NO_ERROR);
  });
  it("requires URL media", () =>
    expect(ForemPublisher.validate({ media: [{ type: "image", path: "x" }] }).isValid).toBe(false));
});
