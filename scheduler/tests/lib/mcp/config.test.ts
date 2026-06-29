import { isAllowedMcpRedirectUri } from "@/lib/mcp/config";

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
