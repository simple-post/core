import { uploadInitError } from "../src/publishers/tiktok/errors";

it.each([
  ["spam_risk_too_many_pending_share", "pending-upload limit", "Open TikTok's inbox"],
  ["rate_limit_exceeded", "6 requests per minute", "one minute"],
  ["spam_risk_too_many_posts", "last 24 hours", "TikTok app"],
  ["reached_active_user_cap", "active-creator limit", "later"],
  ["spam_risk_user_banned_from_posting", "blocked", "account's status"],
  ["access_token_invalid", "expired", "Reconnect"],
  ["scope_not_authorized", "permission", "Reconnect"],
  ["url_ownership_unverified", "ownership", "verified"],
  ["privacy_level_option_mismatch", "privacy", "Choose"],
  ["unaudited_client_can_only_post_to_private_accounts", "private accounts", "audited"],
])("explains %s and keeps safe diagnostic fields", (code, reason, action) => {
  const error = uploadInitError({ error: { code, log_id: "20261024ABC123", message: "unsafe provider message" } }, 403);
  expect(error.errorType).toBe("PUBLISH_REJECTED");
  expect(error.message).toContain(reason);
  expect(error.message).toContain(action);
  expect(error.details).toMatchObject({
    phase: "init",
    httpStatus: 403,
    code,
    logId: "20261024ABC123",
    providerMessage: "unsafe provider message",
    providerResponse: { error: { code, message: "unsafe provider message" } },
  });
});

it.each([200, 400, 403, 429])("recognizes an explicit rejection at HTTP %s", (status) => {
  expect(uploadInitError({ error: { code: "invalid_param" } }, status).errorType).toBe("PUBLISH_REJECTED");
});

it.each([undefined, 408, 500, 503])("preserves uncertainty at HTTP %s", (status) => {
  expect(uploadInitError({ error: { code: "internal_error" } }, status).errorType).toBe("API_ERROR");
});

it("redacts sensitive messages, credentials and signed URLs, including malformed diagnostic fields", () => {
  const secret = "Bearer secret https://upload.tiktok.com/?upload_token=secret";
  const error = uploadInitError(
    { error: { code: secret, log_id: secret, message: secret }, headers: { Authorization: secret } },
    400,
  );
  expect(`${error.message} ${JSON.stringify(error.details)}`).not.toContain("secret");
  expect(error.errorType).toBe("API_ERROR");
});
