import {
  CastAddBody,
  CastType,
  FarcasterNetwork,
  getInsecureHubRpcClient,
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

function parseEndpoint(value: string): { address: string; insecure: boolean } {
  const trimmed = value.trim().replace(/\/$/, "");
  const insecure = trimmed.startsWith("grpc://");
  const address = trimmed.replace(/^grpcs?:\/\//, "");
  if (!address || address.includes("/")) {
    throw new PostError(
      PostErrorType.CREDENTIALS_ERROR,
      `Invalid Farcaster Snapchain endpoint: ${value}. Expected grpcs://host:port.`,
    );
  }
  return { address, insecure };
}

function isRetryableHubError(code: string): boolean {
  return code === "unknown" || code === "unavailable" || code.startsWith("unavailable.");
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
    if (!settings) throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Farcaster options are required");
    let endpoints = settings.snapchainUrls ?? [];
    if (endpoints.length === 0 && settings.hubUrl) endpoints = [settings.hubUrl];
    if (endpoints.length === 0)
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "At least one Farcaster Snapchain endpoint is required");
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
    const errors: string[] = [];
    let submittedSuccessfully = false;
    for (const endpoint of endpoints) {
      const { address, insecure } = parseEndpoint(endpoint);
      const client = insecure ? getInsecureHubRpcClient(address) : getSSLHubRpcClient(address);
      try {
        const submitted = await client.submitMessage(message.value);
        if (submitted.isOk() || submitted.error.errCode === "bad_request.duplicate") {
          submittedSuccessfully = true;
          break;
        }
        errors.push(`${address}: ${submitted.error.message}`);
        if (!isRetryableHubError(submitted.error.errCode)) break;
      } catch (error) {
        errors.push(`${address}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        client.close();
      }
    }
    if (!submittedSuccessfully)
      throw new PostError(
        PostErrorType.API_ERROR,
        `Farcaster Snapchain rejected the cast: ${errors.join("; ") || "submission failed"}`,
      );
    const hash = Buffer.from(message.value.hash).toString("hex");
    return {
      id: `0x${hash}`,
      url: settings.username ? `https://farcaster.xyz/${settings.username.replace(/^@/, "")}/0x${hash}` : undefined,
      error: PostErrorType.NO_ERROR,
      extraData: {
        platformData: { fid: this.fid },
        ...(settings.signerTtlSeconds
          ? { refreshedCredentials: { expiresAt: Math.floor(Date.now() / 1000) + settings.signerTtlSeconds } }
          : {}),
      },
    };
  }
}
