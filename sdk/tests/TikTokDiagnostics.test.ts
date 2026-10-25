import { getTikTokErrorDetails } from "../src/publishers/tiktok/diagnostics";

it("retains the complete provider envelope, message, response headers and operation context", () => {
  const body = {
    error: {
      code: "invalid_param",
      message: "The declared video size does not match",
      log_id: "log_123",
      extra: { field: "video_size", expected: 123 },
    },
    data: { publish_id: "v_inbox_file~123", uploaded_bytes: 7 },
    future_field: [1, { diagnostic: "new detail" }],
  };
  expect(
    getTikTokErrorDetails(
      {
        response: {
          status: 400,
          statusText: "Bad Request",
          data: body,
          headers: { "retry-after": "60", "x-tt-logid": "header_123" },
        },
      },
      {
        phase: "init",
        endpoint: "/v2/post/publish/inbox/video/init/",
        method: "POST",
        publishMode: "draft",
        mediaType: "video",
        fileSize: 123,
      },
    ),
  ).toMatchObject({
    phase: "init",
    httpStatus: 400,
    httpStatusText: "Bad Request",
    code: "invalid_param",
    logId: "log_123",
    providerMessage: body.error.message,
    providerResponse: body,
    responseHeaders: { "retry-after": "60", "x-tt-logid": "header_123" },
    fileSize: 123,
    publishMode: "draft",
  });
});

it("captures OAuth errors, non-JSON bodies, header request IDs, and network causes", () => {
  expect(
    getTikTokErrorDetails(
      { response: { status: 400, data: { error: "invalid_grant", error_description: "Refresh token revoked" } } },
      { phase: "token_refresh" },
    ),
  ).toMatchObject({ code: "invalid_grant", providerMessage: "Refresh token revoked" });
  expect(
    getTikTokErrorDetails(
      {
        response: {
          status: 502,
          data: Buffer.from("<html>Upstream unavailable</html>"),
          headers: { "X-Tt-Logid": "edge_123" },
        },
      },
      { phase: "upload" },
    ),
  ).toMatchObject({ providerResponse: "<html>Upstream unavailable</html>", logId: "edge_123" });
  const error = Object.assign(new Error("socket closed"), {
    code: "ECONNRESET",
    cause: Object.assign(new Error("connection reset"), { code: "EPIPE" }),
    config: { timeout: 30_000 },
  });
  expect(getTikTokErrorDetails(error, { phase: "upload" })).toMatchObject({
    transport: {
      code: "ECONNRESET",
      message: "socket closed",
      timeoutMs: 30_000,
      cause: { code: "EPIPE", message: "connection reset" },
    },
  });
});

it("redacts credentials and signed URLs without serializing request configuration or toJSON hooks", () => {
  const toJSON = jest.fn(() => ({ secret: "must-never-run" }));
  const details = getTikTokErrorDetails(
    {
      config: { headers: { Authorization: "outgoing-secret" }, data: "outgoing-post-content" },
      request: { password: "request-secret" },
      toJSON,
      response: {
        status: 403,
        headers: { "set-cookie": "cookie-secret", Authorization: "header-secret", "x-tt-logid": "safe_log_id" },
        data: {
          error: {
            code: "invalid_param",
            message:
              "Rejected known-access-token; Bearer bearer-secret; see https://upload.example/video?custom_signature=query-secret#fragment-secret",
          },
          nested: [
            {
              access_token: "nested-secret",
              refreshToken: "refresh-secret",
              client_secret: "client-secret",
              upload_url: "https://upload.example/path-token",
            },
          ],
          text: "upload_token=text-secret",
          callback: toJSON,
        },
      },
    },
    { phase: "init" },
    ["known-access-token"],
  );
  const serialized = JSON.stringify(details);
  for (const value of [
    "outgoing-secret",
    "outgoing-post-content",
    "request-secret",
    "cookie-secret",
    "header-secret",
    "known-access-token",
    "bearer-secret",
    "query-secret",
    "fragment-secret",
    "nested-secret",
    "refresh-secret",
    "client-secret",
    "path-token",
    "text-secret",
  ])
    expect(serialized).not.toContain(value);
  expect(serialized).toContain("safe_log_id");
  expect(toJSON).not.toHaveBeenCalled();
});

it("bounds oversized/circular diagnostics and explicitly marks truncation", () => {
  const body: Record<string, unknown> = { loop: null, large: "x".repeat(100_000) };
  body.loop = body;
  const details = getTikTokErrorDetails({ response: { status: 500, data: body } }, { phase: "status" });
  expect(details).toMatchObject({ phase: "status", httpStatus: 500, diagnosticsTruncated: true });
  expect(JSON.stringify(details)).toContain("[Circular]");
  expect(JSON.stringify(details).length).toBeLessThan(70_000);
});
