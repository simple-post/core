import OAuthAuthorizePage from "@/app/oauth/authorize/page";

jest.mock("@/components/authorize-page", () => ({ AuthorizePage: () => null }));

afterEach(() => jest.restoreAllMocks());

it.each(["read_only", "read_write"] as const)(
  "submits the user's %s choice while preserving the OAuth request",
  async (mode) => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const page = OAuthAuthorizePage();
    const config = page.props.config;
    expect(config.allowReadOnly).toBe(true);
    const params = new URLSearchParams({
      client_id: "muse-client",
      redirect_uri: "https://example.com/callback",
      state: "original-state",
      code_challenge: "original-challenge",
      scope: "accounts:read posts:read posts:write",
      resource: "https://app.simplepost.social/mcp",
      nonce: "nonce",
    });
    await config.authorize(params, mode);
    expect(fetchMock).toHaveBeenCalledWith("/api/oauth/authorize", expect.objectContaining({ method: "POST" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      ...Object.fromEntries(params),
      code_challenge_method: "S256",
      access_mode: mode,
    });
  },
);
