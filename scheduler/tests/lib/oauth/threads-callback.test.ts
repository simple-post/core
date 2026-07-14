import { authLogger } from "@/lib/logger";
import { handleThreadsCallback } from "@/lib/oauth/callbacks/threads";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";

jest.mock("@/lib/logger", () => ({
  authLogger: {
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock("@/lib/oauth/config", () => ({
  getPlatformOAuthConfig: jest.fn(() => ({ clientSecret: "threads-app-secret" })),
}));

jest.mock("@/lib/oauth/upsert", () => ({
  upsertConnectedAccount: jest.fn(),
}));

const fetchMock = jest.fn();
const authLoggerErrorMock = authLogger.error as jest.Mock;
const upsertConnectedAccountMock = upsertConnectedAccount as jest.Mock;

const callbackContext = {
  userId: "user-1",
  platform: "threads",
  baseURL: "https://app.simplepost.social",
  tokenData: { access_token: "short-lived-token", user_id: "threads-user-1" },
  accessToken: "short-lived-token",
  refreshToken: null,
  expiresIn: undefined,
  scope: "threads_basic,threads_content_publish",
  tokenMetadata: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe("Threads OAuth callback logging", () => {
  it("logs Meta's structured error details when the long-lived token exchange fails", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Invalid OAuth access token",
            type: "OAuthException",
            code: 190,
            error_subcode: 460,
            error_user_title: "Authorization expired",
            error_user_msg: "Please authorize the app again.",
            is_transient: false,
            fbtrace_id: "meta-trace-123",
            access_token: "must-not-be-logged",
          },
        }),
        { status: 400, statusText: "Bad Request" },
      ),
    );

    await expect(handleThreadsCallback(callbackContext)).rejects.toThrow("Failed to get long-lived Threads token");

    expect(authLoggerErrorMock).toHaveBeenCalledWith(
      {
        status: 400,
        statusText: "Bad Request",
        providerError: {
          message: "Invalid OAuth access token",
          type: "OAuthException",
          code: 190,
          errorSubcode: 460,
          errorUserTitle: "Authorization expired",
          errorUserMessage: "Please authorize the app again.",
          isTransient: false,
          traceId: "meta-trace-123",
        },
      },
      "Failed to exchange for long-lived Threads token",
    );
    expect(JSON.stringify(authLoggerErrorMock.mock.calls)).not.toContain("must-not-be-logged");
    expect(upsertConnectedAccountMock).not.toHaveBeenCalled();
  });

  it("still logs HTTP context when Meta returns a non-JSON error", async () => {
    fetchMock.mockResolvedValue(new Response("upstream error", { status: 502, statusText: "Bad Gateway" }));

    await expect(handleThreadsCallback(callbackContext)).rejects.toThrow("Failed to get long-lived Threads token");

    expect(authLoggerErrorMock).toHaveBeenCalledWith(
      {
        status: 502,
        statusText: "Bad Gateway",
        providerError: undefined,
      },
      "Failed to exchange for long-lived Threads token",
    );
  });
});
