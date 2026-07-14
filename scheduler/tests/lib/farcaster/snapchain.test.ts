import { getSSLHubRpcClient, MessageType } from "@farcaster/hub-nodejs";
import { bytesToHex, decodeAbiParameters, hexToBytes, recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { completeFarcasterConnection, prepareFarcasterConnection } from "@/lib/farcaster/snapchain";
import { getEncryptionProvider } from "@/lib/security/encryption";

import type { Hex } from "viem";

jest.mock("@farcaster/hub-nodejs", () => {
  const actual = jest.requireActual("@farcaster/hub-nodejs");
  return { ...actual, getSSLHubRpcClient: jest.fn() };
});

const getClientMock = getSSLHubRpcClient as jest.MockedFunction<typeof getSSLHubRpcClient>;
const appPrivateKey = `0x${"22".repeat(32)}` as Hex;
const userPrivateKey = `0x${"11".repeat(32)}` as Hex;
const appAccount = privateKeyToAccount(appPrivateKey);
const userAccount = privateKeyToAccount(userPrivateKey);

function ok<T>(value: T) {
  return { isErr: () => false, isOk: () => true, value };
}

describe("Farcaster Snapchain signer flow", () => {
  const submitMessage = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.FARCASTER_APP_FID = "456";
    process.env.FARCASTER_APP_CUSTODY_PRIVATE_KEY = appPrivateKey;
    process.env.FARCASTER_SNAPCHAIN_URLS = "grpcs://snapchain.example:3383";
    process.env.FARCASTER_SIGNER_TTL_SECONDS = "2592000";

    const client = {
      close: jest.fn(),
      getIdRegistryOnChainEventByAddress: jest.fn(async ({ address }: { address: Uint8Array }) => {
        const requested = bytesToHex(address).toLowerCase();
        const isApp = requested === appAccount.address.toLowerCase();
        return ok({
          fid: isApp ? 456 : 123,
          idRegisterEventBody: { to: hexToBytes(isApp ? appAccount.address : userAccount.address) },
        });
      }),
      getSigner: jest.fn(async ({ signer }: { signer: Uint8Array }) =>
        ok({
          signer: {
            fid: 123,
            key: signer,
            requestFid: 456,
            scopes: [1, 2],
            ttl: 2_592_000,
            expiresAt: Math.floor(Date.now() / 1000) + 2_592_000,
          },
        }),
      ),
      getSignersByFid: jest.fn(async () =>
        ok({
          currentUserNonce: 7,
          gaslessSignerCount: 1,
          gaslessSignerLimit: 1000,
          requesterFidNonces: {},
          signers: [],
        }),
      ),
      getUserNameProofsByFid: jest.fn(async () =>
        ok({ proofs: [{ name: new TextEncoder().encode("alice"), type: 1 }] }),
      ),
      submitMessage,
    };
    submitMessage.mockResolvedValue(ok({}));
    getClientMock.mockReturnValue(client as never);
  });

  afterEach(() => {
    delete process.env.FARCASTER_APP_FID;
    delete process.env.FARCASTER_APP_CUSTODY_PRIVATE_KEY;
    delete process.env.FARCASTER_SNAPCHAIN_URLS;
    delete process.env.FARCASTER_SIGNER_TTL_SECONDS;
  });

  it("creates and submits a custody-authorized cast-only signer", async () => {
    const prepared = await prepareFarcasterConnection("user-1", userAccount.address);

    expect(prepared.typedData.domain).toEqual({ name: "Farcaster KeyAdd", version: "1", chainId: 1 });
    expect(prepared.typedData.message).toEqual(
      expect.objectContaining({
        fid: 123,
        keyType: 1,
        scopes: [MessageType.CAST_ADD, MessageType.CAST_REMOVE],
        ttl: 2_592_000,
        nonce: 8,
      }),
    );
    expect(prepared.requestToken).toMatch(/^enc:v1:/);
    const tokenPayload = JSON.parse(getEncryptionProvider().decrypt(prepared.requestToken));
    expect(tokenPayload).toEqual(
      expect.objectContaining({ purpose: "farcaster-key-add", userId: "user-1", fid: 123, scopes: [1, 2] }),
    );
    expect(prepared.requestToken).not.toContain(tokenPayload.signerPrivateKey);

    const signature = await userAccount.signTypedData({
      domain: prepared.typedData.domain,
      types: { KeyAdd: prepared.typedData.types.KeyAdd },
      primaryType: "KeyAdd",
      message: {
        ...prepared.typedData.message,
        fid: BigInt(prepared.typedData.message.fid),
        deadline: BigInt(prepared.typedData.message.deadline),
      },
    });
    const connected = await completeFarcasterConnection("user-1", prepared.requestToken, signature);

    expect(connected).toEqual(
      expect.objectContaining({ fid: 123, requestFid: 456, scopes: [1, 2], ttl: 2_592_000, username: "alice" }),
    );
    expect(submitMessage).toHaveBeenCalledTimes(1);
    const submitted = submitMessage.mock.calls[0][0];
    expect(submitted.data).toEqual(expect.objectContaining({ type: MessageType.KEY_ADD, fid: 123, network: 1 }));
    expect(submitted.data?.keyAddBody).toEqual(
      expect.objectContaining({ keyType: 1, nonce: 8, scopes: [1, 2], ttl: 2_592_000 }),
    );

    const [metadata] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "requestFid", type: "uint256" },
            { name: "requestSigner", type: "address" },
            { name: "signature", type: "bytes" },
            { name: "deadline", type: "uint256" },
          ],
        },
      ],
      bytesToHex(submitted.data!.keyAddBody!.metadata),
    );
    expect(metadata.requestFid).toBe(BigInt(456));
    expect(metadata.requestSigner.toLowerCase()).toBe(appAccount.address.toLowerCase());
    const recoveredApp = await recoverTypedDataAddress({
      domain: { name: "Farcaster KeyAdd", version: "1", chainId: 1 },
      types: {
        SignedKeyRequest: [
          { name: "requestFid", type: "uint256" },
          { name: "key", type: "bytes" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "SignedKeyRequest",
      message: {
        requestFid: metadata.requestFid,
        key: bytesToHex(submitted.data!.keyAddBody!.key),
        deadline: metadata.deadline,
      },
      signature: metadata.signature,
    });
    expect(recoveredApp.toLowerCase()).toBe(appAccount.address.toLowerCase());
  });

  it("rejects an unencrypted request token before attempting a signature", async () => {
    await expect(completeFarcasterConnection("user-1", '{"fid":123}', `0x${"11".repeat(65)}`)).rejects.toThrow(
      "Invalid Farcaster authorization request",
    );
    expect(submitMessage).not.toHaveBeenCalled();
  });
});
