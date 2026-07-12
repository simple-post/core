import {
  CastAddBody,
  CastType,
  FarcasterNetwork,
  getSSLHubRpcClient,
  makeCastAdd,
  NobleEd25519Signer,
} from "@farcaster/hub-nodejs";

import { FARCASTER_VALIDATION_RULES, validateFarcasterContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

function parseSignerKey(value: string): Uint8Array {
  const normalized = value.trim().replace(/^0x/, "");
  if (!/^[a-fA-F0-9]{64}$/.test(normalized))
    throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Farcaster signer private key must be 32-byte hex.");
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}
export class FarcasterPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;
  private readonly fid: number;
  private readonly signer: NobleEd25519Signer;
  constructor(options?: PostOptionsWithCredentials) {
    super("Farcaster", options);
    const credentials = options?.farcaster?.credentials;
    if (!credentials) throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Farcaster credentials are required");
    this.fid = credentials.fid;
    this.signer = new NobleEd25519Signer(parseSignerKey(credentials.signerPrivateKey));
  }
  static getValidationRules(): PlatformValidationRules {
    return FARCASTER_VALIDATION_RULES;
  }
  static validate(content: Content): ValidationResult {
    return validateFarcasterContent(content);
  }
  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = FarcasterPublisher.validate(content);
    if (!validation.isValid)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Farcaster content validation failed", validation);
    const settings = options?.farcaster;
    if (!settings?.hubUrl) throw new PostError(PostErrorType.INVALID_CONTENT, "Farcaster hubUrl is required");
    const bytes = Buffer.byteLength(content.text ?? "", "utf8");
    const body = CastAddBody.create({
      text: content.text ?? "",
      embeds: content.media?.map((item) => ({ url: item.url })) ?? [],
      embedsDeprecated: [],
      mentions: [],
      mentionsPositions: [],
      type: bytes > 320 ? CastType.LONG_CAST : CastType.CAST,
    });
    const message = await makeCastAdd(body, { fid: this.fid, network: FarcasterNetwork.MAINNET }, this.signer);
    if (message.isErr()) throw new PostError(PostErrorType.INVALID_CONTENT, message.error.message);
    const client = getSSLHubRpcClient(settings.hubUrl.replace(/^grpcs?:\/\//, "").replace(/\/$/, ""));
    try {
      const submitted = await client.submitMessage(message.value);
      if (submitted.isErr())
        throw new PostError(PostErrorType.API_ERROR, `Farcaster Hub rejected the cast: ${submitted.error.message}`);
      const hash = Buffer.from(message.value.hash).toString("hex");
      return {
        id: `0x${hash}`,
        url: settings.username ? `https://farcaster.xyz/${settings.username.replace(/^@/, "")}/0x${hash}` : undefined,
        error: PostErrorType.NO_ERROR,
        extraData: { platformData: { fid: this.fid } },
      };
    } finally {
      client.close();
    }
  }
}
