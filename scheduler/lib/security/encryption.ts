import crypto from "node:crypto";

export interface EncryptionProvider {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

const ENCRYPTED_PREFIX = "enc:v1:";

class AesGcmEncryptionProvider implements EncryptionProvider {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) {
      throw new Error("SCHEDULER_ENCRYPTION_KEY must decode to exactly 32 bytes");
    }

    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const payload = Buffer.concat([iv, authTag, encrypted]).toString("base64");

    return `${ENCRYPTED_PREFIX}${payload}`;
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
      return ciphertext;
    }

    const encodedPayload = ciphertext.slice(ENCRYPTED_PREFIX.length);
    const payload = Buffer.from(encodedPayload, "base64");

    const iv = payload.subarray(0, 12);
    const authTag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);

    const decipher = crypto.createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}

function decodeEncryptionKey(value: string): Buffer {
  const trimmed = value.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  return Buffer.from(trimmed, "base64");
}

let encryptionProvider: EncryptionProvider | null = null;

function createDefaultProvider(): EncryptionProvider {
  const keyValue = process.env.SCHEDULER_ENCRYPTION_KEY;
  if (!keyValue) {
    throw new Error("SCHEDULER_ENCRYPTION_KEY is required for connected account secret encryption");
  }

  return new AesGcmEncryptionProvider(decodeEncryptionKey(keyValue));
}

export function getEncryptionProvider(): EncryptionProvider {
  if (!encryptionProvider) {
    encryptionProvider = createDefaultProvider();
  }

  return encryptionProvider;
}

export function isEncryptedValue(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}
