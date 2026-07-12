import { FarcasterPublisher } from "../src/publishers/farcaster";
import { PostError } from "../src/types";
describe("FarcasterPublisher", () => {
  it("rejects an invalid signer key", () => {
    expect(
      () =>
        new FarcasterPublisher({
          farcaster: { hubUrl: "hub.example.com:2283", credentials: { fid: 1, signerPrivateKey: "bad" } },
        }),
    ).toThrow(PostError);
  });
  it("enforces UTF-8 byte limits and URL embeds", () => {
    expect(FarcasterPublisher.validate({ text: "😀".repeat(300) }).isValid).toBe(false);
    expect(FarcasterPublisher.validate({ media: [{ type: "image", path: "image.jpg" }] }).isValid).toBe(false);
  });
});
