import { finalizeEvent, getPublicKey, nip19, SimplePool } from "nostr-tools";

import { NOSTR_VALIDATION_RULES, validateNostrContent } from "./validation";

import { PostError, PostErrorType } from "../../types";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationResult } from "../../types/validation";

function decodePrivateKey(value: string): Uint8Array {
  const key = value.trim();
  try {
    if (key.startsWith("nsec1")) {
      const decoded = nip19.decode(key);
      if (decoded.type !== "nsec") throw new Error("Not an nsec key");
      return decoded.data;
    }
    if (/^[a-fA-F0-9]{64}$/.test(key)) return Uint8Array.from(Buffer.from(key, "hex"));
  } catch {
    // Normalize all decoding failures into the credential error below.
  }
  throw new PostError(
    PostErrorType.CREDENTIALS_ERROR,
    "Nostr private key must be a valid nsec or 64-character hex key.",
  );
}

export function getNostrPublicKey(privateKey: string): string {
  return getPublicKey(decodePrivateKey(privateKey));
}

export class NostrPublisher extends Publisher {
  static readonly mediaRequirement = "url" as const;
  private readonly privateKey: Uint8Array;

  constructor(options?: PostOptionsWithCredentials) {
    super("Nostr", options);
    if (!options?.nostr?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Nostr credentials are required in options.nostr.credentials",
      );
    }
    this.privateKey = decodePrivateKey(options.nostr.credentials.privateKey);
  }

  static getValidationRules(): PlatformValidationRules {
    return NOSTR_VALIDATION_RULES;
  }

  static validate(content: Content): ValidationResult {
    return validateNostrContent(content);
  }

  async postContent(content: Content, options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = NostrPublisher.validate(content);
    if (!validation.isValid)
      throw new PostError(PostErrorType.INVALID_CONTENT, "Nostr content validation failed", validation);
    const relays = options?.nostr?.relays;
    if (!relays?.length) throw new PostError(PostErrorType.INVALID_CONTENT, "At least one Nostr relay is required.");
    const mediaUrls = content.media?.map((item) => item.url!).filter(Boolean) ?? [];
    const noteContent = [content.text?.trim(), ...mediaUrls].filter(Boolean).join("\n\n");
    const tags = options?.nostr?.subject ? [["subject", options.nostr.subject]] : [];
    const event = finalizeEvent(
      { kind: 1, created_at: Math.floor(Date.now() / 1000), tags, content: noteContent },
      this.privateKey,
    );
    const pool = new SimplePool();
    try {
      const results = await Promise.allSettled(pool.publish(relays, event));
      const accepted = results.filter((result) => result.status === "fulfilled").length;
      if (accepted === 0) {
        const messages = results
          .map((result) => (result.status === "rejected" ? String(result.reason) : ""))
          .filter(Boolean);
        throw new PostError(
          PostErrorType.API_ERROR,
          `No Nostr relay accepted the event${messages.length > 0 ? `: ${messages.join("; ")}` : "."}`,
        );
      }
      return {
        id: event.id,
        url: `https://njump.me/${nip19.noteEncode(event.id)}`,
        error: PostErrorType.NO_ERROR,
        extraData: { platformData: { pubkey: event.pubkey, acceptedRelays: accepted, totalRelays: relays.length } },
      };
    } finally {
      pool.close(relays);
    }
  }
}
