import { getEncryptionProvider } from "@/lib/security/encryption";

import type { Prisma } from "@prisma/client";

const METADATA_ENCRYPTED_KEY = "__encrypted";

function encryptString(value: string | null | undefined): string | null | undefined {
  if (!value) {
    return value;
  }

  return getEncryptionProvider().encrypt(value);
}

function decryptString(value: string | null | undefined): string | null | undefined {
  if (!value) {
    return value;
  }

  return getEncryptionProvider().decrypt(value);
}

export function encryptTokenMetadata(metadata: Prisma.InputJsonValue | null | undefined): Prisma.InputJsonValue | null | undefined {
  if (!metadata) {
    return metadata;
  }

  const payload = JSON.stringify(metadata);
  return { [METADATA_ENCRYPTED_KEY]: getEncryptionProvider().encrypt(payload) } satisfies Prisma.InputJsonObject;
}

export function decryptTokenMetadata(metadata: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }

  const encryptedPayload = (metadata as Record<string, unknown>)[METADATA_ENCRYPTED_KEY];
  if (typeof encryptedPayload !== "string") {
    return metadata;
  }

  const decryptedPayload = getEncryptionProvider().decrypt(encryptedPayload);
  return JSON.parse(decryptedPayload) as Prisma.JsonValue;
}

export function encryptConnectedAccountSecrets<T extends { accessToken?: string; refreshToken?: string | null; tokenMetadata?: Prisma.InputJsonValue | null }>(
  data: T,
): T {
  return {
    ...data,
    accessToken: encryptString(data.accessToken),
    refreshToken: encryptString(data.refreshToken),
    tokenMetadata: encryptTokenMetadata(data.tokenMetadata),
  };
}

export function decryptConnectedAccountSecrets<T extends { accessToken: string; refreshToken: string | null; tokenMetadata: Prisma.JsonValue | null }>(
  account: T,
): T {
  return {
    ...account,
    accessToken: decryptString(account.accessToken) || "",
    refreshToken: decryptString(account.refreshToken) || null,
    tokenMetadata: decryptTokenMetadata(account.tokenMetadata),
  };
}
