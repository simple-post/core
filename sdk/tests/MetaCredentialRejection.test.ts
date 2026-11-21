import { readinessFailure } from "../src/utils/account-readiness";
import { getMetaCredentialRejection } from "../src/utils/meta-credential-rejection";

const message =
  "Error validating access token: The session has been invalidated because the user changed their password or Facebook has changed the session for security reasons.";
const response = (status: number, error: Record<string, unknown>) => ({ response: { status, data: { error } } });

it("retains the production subcode-zero diagnosis without arbitrary provider/request data", () => {
  const input = {
    ...response(401, { code: 190, error_subcode: 0, message, fbtrace_id: "safe-trace", token: "provider-secret" }),
    config: { headers: { Authorization: "Bearer request-secret" } },
    message: "https://graph.instagram.com/me?access_token=url-secret",
  };
  const issue = readinessFailure("instagram", input);
  expect(issue).toMatchObject({
    code: "account_unauthorized",
    severity: "error",
    credentialRejection: { reason: "session_revoked", code: 190, status: 401, subcode: 0, traceId: "safe-trace" },
  });
  expect(JSON.stringify(issue)).not.toContain("secret");
  expect(JSON.stringify(issue)).not.toContain(message);
});

it.each([
  [{ code: 190, error_subcode: 460, message: "localized provider message" }, "session_revoked"],
  [{ code: 190, error_subcode: 458 }, "authorization_removed"],
  [{ code: 190, message: "The user has not authorized application 123." }, "authorization_removed"],
])("recognizes permanent code/subcode or message evidence %j", (error, reason) => {
  expect(getMetaCredentialRejection(response(400, error))).toMatchObject({ reason, code: 190, status: 400 });
  expect(getMetaCredentialRejection({ error })).toMatchObject({ reason });
});

it.each([
  response(429, { code: 190, message }),
  response(500, { code: 190, message }),
  response(403, { code: 10, message }),
  response(401, { code: 190, message: "Session has expired" }),
  response(401, { code: 190, message: "Invalid OAuth access token" }),
  response(401, { code: 190, message, is_transient: true }),
  response(401, { code: 190, error_subcode: 463, message }),
  response(401, { message }),
  { message },
  null,
])("does not persist revocation for inconclusive or recoverable evidence %j", (error) => {
  expect(getMetaCredentialRejection(error)).toBeUndefined();
});

it.each([
  ["facebook", "Facebook"],
  ["threads", "Threads"],
] as const)("applies the shared Graph API evidence to %s", (platform, label) => {
  expect(readinessFailure(platform, response(401, { code: 190, error_subcode: 458 }))).toMatchObject({
    platform,
    code: "account_unauthorized",
    severity: "error",
    message: `${label} invalidated this connection. Reconnect the account before publishing.`,
    credentialRejection: { reason: "authorization_removed", code: 190, status: 401, subcode: 458 },
  });
});

it("does not apply Meta persistence evidence to other platforms", () => {
  for (const platform of ["x", "bluesky", "linkedin"] as const)
    expect(readinessFailure(platform, response(401, { code: 190, message })).credentialRejection).toBeUndefined();
});

it("drops malformed trace identifiers and ignores response fields outside the allowlist", () => {
  const evidence = getMetaCredentialRejection(response(401, { code: 190, message, fbtrace_id: "Bearer secret" }));
  expect(evidence).toEqual({ reason: "session_revoked", code: 190, status: 401 });
});
