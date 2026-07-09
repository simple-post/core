import { Publisher } from "../src/publishers/base";
import { PostErrorType } from "../src/types";

import type { PostResult } from "../src/types";
import type { Content } from "../src/types/post";

class NonQuotePublisher extends Publisher {
  posted: Content[] = [];

  constructor() {
    super("fallback");
  }

  protected async postContent(content: Content): Promise<PostResult> {
    this.posted.push(content);
    return { id: "ordinary-post", error: PostErrorType.NO_ERROR };
  }
}

describe("Publisher quote fallback", () => {
  it("publishes ordinary content when a platform has no native quote support", async () => {
    const publisher = new NonQuotePublisher();

    const result = await publisher.quote({ text: "A cross-platform take" }, { postId: "source-post" });

    expect(publisher.posted).toEqual([{ text: "A cross-platform take" }]);
    expect(result).toEqual({ id: "ordinary-post", error: PostErrorType.NO_ERROR });
  });
});
