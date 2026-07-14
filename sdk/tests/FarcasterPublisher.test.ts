import { getInsecureHubRpcClient, getSSLHubRpcClient } from "@farcaster/hub-nodejs";

import { FarcasterPublisher } from "../src/publishers/farcaster";
import { PostError } from "../src/types";

jest.mock("@farcaster/hub-nodejs", () => {
  const actual = jest.requireActual("@farcaster/hub-nodejs");
  return {
    ...actual,
    getInsecureHubRpcClient: jest.fn(),
    getSSLHubRpcClient: jest.fn(),
  };
});

const getInsecureClientMock = getInsecureHubRpcClient as jest.MockedFunction<typeof getInsecureHubRpcClient>;
const getSSLClientMock = getSSLHubRpcClient as jest.MockedFunction<typeof getSSLHubRpcClient>;

describe("FarcasterPublisher", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects an invalid signer key", () => {
    expect(
      () =>
        new FarcasterPublisher({
          farcaster: {
            snapchainUrls: ["grpcs://snap.example.com:3383"],
            credentials: { fid: 1, signerPrivateKey: "bad" },
          },
        }),
    ).toThrow(PostError);
  });
  it("enforces UTF-8 byte limits and URL embeds", () => {
    expect(FarcasterPublisher.validate({ text: "😀".repeat(300) }).isValid).toBe(false);
    expect(FarcasterPublisher.validate({ media: [{ type: "image", path: "image.jpg" }] }).isValid).toBe(false);
  });

  it("fails over between Snapchain endpoints and advances the sliding signer expiry", async () => {
    const firstClient = { close: jest.fn(), submitMessage: jest.fn().mockRejectedValue(new Error("offline")) };
    const secondClient = {
      close: jest.fn(),
      submitMessage: jest.fn().mockResolvedValue({ isOk: () => true, isErr: () => false, value: {} }),
    };
    getSSLClientMock.mockReturnValue(firstClient as never);
    getInsecureClientMock.mockReturnValue(secondClient as never);
    const options = {
      farcaster: {
        snapchainUrls: ["grpcs://primary.example:3383", "grpc://secondary.example:3383"],
        signerTtlSeconds: 2_592_000,
        credentials: { fid: 123, signerPrivateKey: "11".repeat(32) },
      },
    };
    const publisher = new FarcasterPublisher(options);

    const result = await publisher.postContent({ text: "Hello Farcaster" }, options);

    expect(result.error).toBe("NO_ERROR");
    expect(getSSLClientMock).toHaveBeenCalledWith("primary.example:3383");
    expect(getInsecureClientMock).toHaveBeenCalledWith("secondary.example:3383");
    expect(firstClient.close).toHaveBeenCalled();
    expect(secondClient.close).toHaveBeenCalled();
    expect(result.extraData?.refreshedCredentials?.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});
