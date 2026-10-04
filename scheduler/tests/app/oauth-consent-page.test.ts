import { OAuthConsent } from "@/app/oauth/authorize/oauth-consent";
import OAuthAuthorizePage from "@/app/oauth/authorize/page";

jest.mock("@/components/authorize-page", () => ({ AuthorizePage: () => null }));

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.MUSE_OAUTH_CLIENT_IDS;
});

it.each(["chatgpt-client", "claude-client", "cursor-client", undefined, ["muse-client", "other"]])(
  "does not show the read-only choice for an unapproved or invalid client: %j",
  async (client_id) => {
    process.env.MUSE_OAUTH_CLIENT_IDS = "muse-client";
    const page = await OAuthAuthorizePage({ searchParams: Promise.resolve({ client_id, platform: "muse" }) });
    expect(page.props.allowReadOnly).toBe(false);
    expect(OAuthConsent(page.props).props.config.allowReadOnly).toBe(false);
  },
);

it("enables the choice only for a deployment-approved Muse OAuth client ID", async () => {
  process.env.MUSE_OAUTH_CLIENT_IDS = "muse-client";
  const page = await OAuthAuthorizePage({ searchParams: Promise.resolve({ client_id: "muse-client" }) });
  expect(page.props.allowReadOnly).toBe(true);
});

it("leaves all clients on the original UI when the allowlist is unset", async () => {
  delete process.env.MUSE_OAUTH_CLIENT_IDS;
  const page = await OAuthAuthorizePage({ searchParams: Promise.resolve({ client_id: "muse-client" }) });
  expect(page.props.allowReadOnly).toBe(false);
});

it.each(["read_only", "read_write"] as const)(
  "submits the user's %s choice while preserving the OAuth request",
  async (mode) => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const page = OAuthConsent({ allowReadOnly: true });
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

it("omits the Muse form field entirely for other clients", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
  const config = OAuthConsent({ allowReadOnly: false }).props.config;
  await config.authorize(new URLSearchParams({ client_id: "chatgpt-client" }), "read_only");
  const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
  expect(body).not.toHaveProperty("access_mode");
});
