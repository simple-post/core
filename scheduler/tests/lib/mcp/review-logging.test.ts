import {
  prepareReviewMcpPayload,
  prepareReviewToolCallSummary,
  shouldLogReviewMcpExchange,
} from "@/lib/mcp/review-logging";

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

  it("summarizes only the basics of an actual tool call", () => {
    expect(
      prepareReviewToolCallSummary(
        {
          jsonrpc: "2.0",
          method: "tools/call",
          params: { name: "create_post", arguments: { content: "Unique demo post", publishNow: false } },
          id: 7,
        },
        { jsonrpc: "2.0", result: { isError: false, structuredContent: { postId: "post-123" } }, id: 7 },
        200,
      ),
    ).toEqual({
      arguments: '{"content":"Unique demo post","publishNow":false}',
      succeeded: true,
      toolName: "create_post",
    });
  });

  it("does not create Telegram summaries for MCP setup traffic", () => {
    expect(
      prepareReviewToolCallSummary(
        { jsonrpc: "2.0", method: "tools/list", id: 1 },
        { jsonrpc: "2.0", result: { tools: [] }, id: 1 },
        200,
      ),
    ).toBeNull();
  });

  it("reduces tool errors to one short outcome", () => {
    expect(
      prepareReviewToolCallSummary(
        { method: "tools/call", params: { name: "validate_post", arguments: { content: "test" } } },
        { result: { isError: true, content: [{ type: "text", text: "No connected account was found" }] } },
        200,
      ),
    ).toEqual({
      arguments: '{"content":"test"}',
      error: "No connected account was found",
      succeeded: false,
      toolName: "validate_post",
    });
  });
});
