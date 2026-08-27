import { canUpgradeLegacyMcpClientScope, isAllowedMcpRedirectUri, validateMcpScope } from "@/lib/mcp/config";

const originalNodeEnv = process.env.NODE_ENV;

function setNodeEnv(value: typeof process.env.NODE_ENV) {
  Object.defineProperty(process.env, "NODE_ENV", { value, writable: true, configurable: true });
}

afterEach(() => {
  setNodeEnv(originalNodeEnv);
});

describe("isAllowedMcpRedirectUri", () => {
  it.each(["http://localhost:58749/callback", "http://127.0.0.1:58749/callback", "http://[::1]:58749/callback"])(
    "allows HTTP loopback redirects in production: %s",
    (uri) => {
      setNodeEnv("production");

      expect(isAllowedMcpRedirectUri(uri)).toBe(true);
    },
  );

  it("allows HTTPS redirects", () => {
    expect(isAllowedMcpRedirectUri("https://example.com/oauth/callback")).toBe(true);
  });

  it.each([
    "http://example.com/callback",
    "http://localhost.example.com/callback",
    "ftp://localhost/callback",
    "not a url",
  ])("rejects non-HTTPS, non-loopback redirects: %s", (uri) => {
    expect(isAllowedMcpRedirectUri(uri)).toBe(false);
  });

  it.each(["https://example.com/callback#token", "http://localhost:58749/callback#token"])(
    "rejects redirect URIs with fragments: %s",
    (uri) => {
      expect(isAllowedMcpRedirectUri(uri)).toBe(false);
    },
  );
});

describe("OIDC scopes", () => {
  it("accepts openid and email alongside MCP tool scopes", () => {
    expect(validateMcpScope("openid email accounts:read")).toEqual({
      ok: true,
      scope: "openid email accounts:read",
    });
  });

  it("allows existing clients to add the identity scopes during reauthorization", () => {
    expect(
      canUpgradeLegacyMcpClientScope(
        "openid email accounts:read posts:read posts:validate posts:write",
        "accounts:read posts:read posts:validate posts:write",
      ),
    ).toBe(true);
  });

  it("does not allow arbitrary registered-scope expansion", () => {
    expect(canUpgradeLegacyMcpClientScope("openid email posts:write", "accounts:read")).toBe(false);
  });
});
