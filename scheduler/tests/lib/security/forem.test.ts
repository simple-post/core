import { fetchForem, normalizeForemInstanceUrl } from "@/lib/security/forem";

const fetchMock = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe("normalizeForemInstanceUrl", () => {
  it("accepts public HTTPS origins", () => {
    expect(normalizeForemInstanceUrl("https://dev.to/")).toBe("https://dev.to");
    expect(normalizeForemInstanceUrl("https://community.example:8443")).toBe("https://community.example:8443");
  });

  it.each([
    "http://dev.to",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://169.254.169.254",
    "https://metadata.google.internal",
    "https://dev.to/path",
    "https://dev.to/?query=yes",
    "https://user:password@dev.to",
  ])("rejects %s", (url) => {
    expect(() => normalizeForemInstanceUrl(url)).toThrow();
  });
});

describe("fetchForem", () => {
  it("uses manual redirects and the Forem API path", async () => {
    fetchMock.mockResolvedValue({ status: 200, headers: { get: () => null } });

    await fetchForem("https://dev.to", "/api/users/me", { headers: { "api-key": "test" } });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://dev.to/api/users/me",
      expect.objectContaining({ redirect: "manual", dispatcher: expect.anything() }),
    );
  });

  it("rejects redirects to private networks before making a second request", async () => {
    fetchMock.mockResolvedValue({
      status: 302,
      headers: { get: () => "https://127.0.0.1/private" },
    });

    await expect(fetchForem("https://dev.to", "/api/users/me", {})).rejects.toThrow("private networks");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not forward the API key to a different public origin", async () => {
    fetchMock.mockResolvedValue({
      status: 302,
      headers: { get: () => "https://other.example/api/users/me" },
    });

    await expect(fetchForem("https://dev.to", "/api/users/me", { headers: { "api-key": "secret" } })).rejects.toThrow(
      "configured instance origin",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
