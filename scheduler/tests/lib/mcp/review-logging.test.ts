import { prepareReviewMcpPayload, shouldLogReviewMcpExchange } from "@/lib/mcp/review-logging";

describe("review MCP logging", () => {
  const previousEnabled = process.env.ENABLE_OPENAI_TEST_LOGIN;

  afterEach(() => {
    if (previousEnabled === undefined) delete process.env.ENABLE_OPENAI_TEST_LOGIN;
    else process.env.ENABLE_OPENAI_TEST_LOGIN = previousEnabled;
  });

  it("only enables exchange logging for configured review accounts", () => {
    process.env.ENABLE_OPENAI_TEST_LOGIN = "true";

    expect(shouldLogReviewMcpExchange({ userId: "review-user", userEmail: "openai@simplepost.social" })).toBe(true);
    expect(shouldLogReviewMcpExchange({ userId: "regular-user", userEmail: "someone@example.com" })).toBe(false);

    process.env.ENABLE_OPENAI_TEST_LOGIN = "false";
    expect(shouldLogReviewMcpExchange({ userId: "review-user", userEmail: "demo@simplepost.social" })).toBe(false);
  });

  it("keeps JSON-RPC details while recursively redacting credentials", () => {
    const payload = prepareReviewMcpPayload(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          name: "create_post",
          file: { download_url: "https://files.example/signed?token=file-secret" },
          arguments: {
            message: "Unique review post",
            credentials: { accessToken: "secret-access-token" },
          },
        },
        id: 7,
      }),
    );

    expect(payload.text).toContain('"name": "create_post"');
    expect(payload.text).toContain("Unique review post");
    expect(payload.text).toContain("[REDACTED]");
    expect(payload.text).not.toContain("secret-access-token");
    expect(payload.text).not.toContain("file-secret");
  });

  it("does not copy unexpected non-JSON request bodies into logs", () => {
    expect(prepareReviewMcpPayload("password=do-not-log-this").text).toBe("[unparseable non-JSON payload omitted]");
  });
});
