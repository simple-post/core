import axios from "axios";

import { GoogleBusinessProfilePublisher } from "../src/publishers/google-business-profile";
import { PostErrorType } from "../src/types";

import type { PostOptionsWithCredentials } from "../src/types/post";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;
const options: PostOptionsWithCredentials = {
  google_business_profile: { locationName: "accounts/1/locations/2", credentials: { accessToken: "token" } },
};

describe("GoogleBusinessProfilePublisher", () => {
  beforeEach(() => jest.clearAllMocks());
  it("requires URL media", () => {
    expect(GoogleBusinessProfilePublisher.validate({ media: [{ type: "image", path: "image.jpg" }] }).isValid).toBe(
      false,
    );
  });
  it("publishes a standard local post", async () => {
    mockedAxios.post.mockResolvedValue({
      data: { name: "accounts/1/locations/2/localPosts/3", searchUrl: "https://google.com/search?q=test" },
    });
    const result = await new GoogleBusinessProfilePublisher(options).postContent(
      { text: "News", media: [{ type: "image", url: "https://example.com/image.jpg" }] },
      options,
    );
    expect(mockedAxios.post).toHaveBeenCalledWith(
      "https://mybusiness.googleapis.com/v4/accounts/1/locations/2/localPosts",
      expect.objectContaining({
        summary: "News",
        topicType: "STANDARD",
        media: [{ mediaFormat: "PHOTO", sourceUrl: "https://example.com/image.jpg" }],
      }),
      expect.anything(),
    );
    expect(result).toEqual(expect.objectContaining({ id: "3", error: PostErrorType.NO_ERROR }));
  });
});
