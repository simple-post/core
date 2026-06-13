import {
  API_KEY_PREFIX,
  API_KEY_PREVIEW_LENGTH,
  generateApiKey,
  getApiKeyPrefix,
  hashApiKey,
  isApiKey,
} from "@/lib/security/api-keys";

describe("api-keys", () => {
  it("generates keys with the expected prefix and high entropy", () => {
    const key = generateApiKey();

    expect(key.startsWith(API_KEY_PREFIX)).toBe(true);
    // 32 random bytes base64url-encoded = 43 chars
    expect(key.length).toBe(API_KEY_PREFIX.length + 43);
    expect(generateApiKey()).not.toBe(key);
  });

  it("hashes keys deterministically with SHA-256", () => {
    const key = generateApiKey();

    expect(hashApiKey(key)).toBe(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toBe(hashApiKey(generateApiKey()));
  });

  it("identifies api keys by prefix", () => {
    expect(isApiKey(generateApiKey())).toBe(true);
    expect(isApiKey("sp_cli_something")).toBe(false);
    expect(isApiKey("")).toBe(false);
  });

  it("returns a fixed-length preview prefix", () => {
    const key = generateApiKey();
    expect(getApiKeyPrefix(key)).toBe(key.slice(0, API_KEY_PREVIEW_LENGTH));
  });
});
