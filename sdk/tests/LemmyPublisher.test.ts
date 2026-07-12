import axios from "axios";

import { LemmyPublisher } from "../src/publishers/lemmy";
import { PostErrorType } from "../src/types";
jest.mock("axios");
const mocked = axios as jest.Mocked<typeof axios>;
const options = {
  lemmy: { communityId: 1, credentials: { instanceUrl: "https://lemmy.example", jwt: "jwt" } },
} as const;
describe("LemmyPublisher", () => {
  beforeEach(() => jest.clearAllMocks());
  it("publishes through v3", async () => {
    mocked.post.mockResolvedValue({ data: { post_view: { post: { id: 2, ap_id: "https://lemmy.example/post/2" } } } });
    const result = await new LemmyPublisher(options).postContent({ text: "Hello" }, options);
    expect(mocked.post).toHaveBeenCalledWith(
      "https://lemmy.example/api/v3/post",
      expect.objectContaining({ community_id: 1, auth: "jwt", name: "Hello" }),
      { headers: { Authorization: "Bearer jwt" } },
    );
    expect(result.error).toBe(PostErrorType.NO_ERROR);
  });
  it("requires URL media", () =>
    expect(LemmyPublisher.validate({ media: [{ type: "image", path: "x" }] }).isValid).toBe(false));
});
