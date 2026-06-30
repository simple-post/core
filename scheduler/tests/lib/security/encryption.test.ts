import { getEncryptionProvider, isEncryptedValue } from "@/lib/security/encryption";

describe("encryption", () => {
  const provider = getEncryptionProvider();

  it("round-trips plaintext through encrypt/decrypt", () => {
    const secret = "sp_token_with_unicode_𝓼𝓮𝓬𝓻𝓮𝓽";
    const ciphertext = provider.encrypt(secret);

    expect(ciphertext).not.toContain(secret);
    expect(isEncryptedValue(ciphertext)).toBe(true);
    expect(provider.decrypt(ciphertext)).toBe(secret);
  });

  it("produces a different ciphertext for every call (random IV)", () => {
    const first = provider.encrypt("same value");
    const second = provider.encrypt("same value");

    expect(first).not.toBe(second);
    expect(provider.decrypt(first)).toBe("same value");
    expect(provider.decrypt(second)).toBe("same value");
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const ciphertext = provider.encrypt("tamper me");
    const prefix = "enc:v1:";
    const payload = Buffer.from(ciphertext.slice(prefix.length), "base64");

    // Flip one bit in the encrypted portion (after the 12-byte IV and
    // 16-byte auth tag).
    payload[28] ^= 0b0000_0001;
    const tampered = `${prefix}${payload.toString("base64")}`;

    expect(() => provider.decrypt(tampered)).toThrow();
  });

  it("passes through values without the encryption prefix unchanged", () => {
    // Legacy/migration behavior: unprefixed values are treated as plaintext.
    expect(provider.decrypt("plain-legacy-token")).toBe("plain-legacy-token");
    expect(isEncryptedValue("plain-legacy-token")).toBe(false);
  });
});
