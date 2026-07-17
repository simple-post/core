import { nip19, SimplePool } from "nostr-tools";

import { getNostrPublicKey, NostrPublisher } from "../src/publishers/nostr";
import { PostError, PostErrorType } from "../src/types";

import type { PostOptionsWithCredentials } from "../src/types/post";

const PRIVATE_KEY = "0000000000000000000000000000000000000000000000000000000000000001";
const options: PostOptionsWithCredentials = {
  nostr: { relays: ["wss://relay.example.com"], credentials: { privateKey: PRIVATE_KEY } },
};

describe("NostrPublisher", () => {
  afterEach(() => jest.restoreAllMocks());

  it("accepts hex and nsec private keys", () => {
    const expected = getNostrPublicKey(PRIVATE_KEY);
    expect(getNostrPublicKey(nip19.nsecEncode(Uint8Array.from(Buffer.from(PRIVATE_KEY, "hex"))))).toBe(expected);
  });

  it("rejects invalid credentials", () => {
    expect(
      () =>
        new NostrPublisher({ nostr: { relays: ["wss://relay.example.com"], credentials: { privateKey: "invalid" } } }),
    ).toThrow(PostError);
  });

  it("requires public URLs for media", () => {
    expect(NostrPublisher.validate({ media: [{ type: "image", path: "./image.jpg" }] }).isValid).toBe(false);
  });

  it("publishes a signed kind-1 note to configured relays", async () => {
    jest.spyOn(SimplePool.prototype, "publish").mockReturnValue([Promise.resolve("saved")]);
    jest.spyOn(SimplePool.prototype, "close").mockImplementation(() => {});
    const result = await new NostrPublisher(options).postContent({ text: "Hello Nostr" }, options);
    expect(result).toEqual(
      expect.objectContaining({
        error: PostErrorType.NO_ERROR,
        id: expect.stringMatching(/^[a-f0-9]{64}$/),
        url: expect.stringContaining("https://njump.me/note1"),
      }),
    );
  });
});
