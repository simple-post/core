import { context as otelContext } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";

import {
  formatTelegramLogNotification,
  formatTelegramReviewExchange,
  sendTelegramLogNotification,
  sendTelegramReviewExchange,
} from "@/lib/logger/telegram";

jest.mock("@opentelemetry/api", () => ({
  context: {
    active: jest.fn(() => ({ active: true })),
    with: jest.fn((_context: unknown, callback: () => unknown) => callback()),
  },
}));

jest.mock("@opentelemetry/core", () => ({
  suppressTracing: jest.fn(() => ({ suppressed: true })),
}));

describe("Telegram log notifications", () => {
  it("promotes publishing identifiers, reason, trace, and content into the alert", () => {
    const notification = formatTelegramLogNotification({
      level: "error",
      message: "Platform post failed",
      timestamp: "2026-07-22T16:01:02.986Z",
      context: {
        module: "posting",
        userId: "user-123",
        userEmail: "vlad@example.com",
        userName: "Vlad",
        postId: "post-456",
        platform: "x",
        accountId: "account-789",
        accountUsername: "haltakov",
        accountHandle: "@haltakov",
        postingSource: "scheduler",
        traceId: "6128e02b4515227d45876ac3832a7307",
        contentPreview: "You’re not afraid of Mike Tyson.",
        contentLength: 247,
        message: "X images cannot exceed 5 MB. This file is 8.1 MB.",
        error: "INVALID_CONTENT",
      },
    });

    expect(notification).toContain("<b>User:</b> Vlad &lt;vlad@example.com&gt; (user-123)");
    expect(notification).toContain("<b>Post:</b> post-456");
    expect(notification).toContain("<b>Platform:</b> x");
    expect(notification).toContain("<b>Handle:</b> @haltakov");
    expect(notification).toContain("<b>Account ID:</b> account-789");
    expect(notification).toContain("<b>Trace:</b> <code>6128e02b4515227d45876ac3832a7307</code>");
    expect(notification).toContain("<b>Reason:</b> X images cannot exceed 5 MB. This file is 8.1 MB.");
    expect(notification).toContain("<b>Content (247 chars):</b> You’re not afraid of Mike Tyson.");
  });

  it("shows a readable account fallback when a provider has no handle", () => {
    const notification = formatTelegramLogNotification({
      level: "error",
      message: "Platform post failed",
      timestamp: "2026-07-23T10:00:00.000Z",
      context: {
        platform: "facebook",
        accountId: "account-123",
        accountUsername: "Creafex Lab",
      },
    });

    expect(notification).toContain("<b>Account:</b> Creafex Lab");
    expect(notification).toContain("<b>Account ID:</b> account-123");
    expect(notification).not.toContain("<b>Handle:</b>");
  });

  it("formats a compact demo tool-call notification", () => {
    const notification = formatTelegramReviewExchange({
      userEmail: "openai@simplepost.social",
      toolName: "validate_post",
      arguments: '{"content":"Unique review post"}',
      status: 200,
      durationMs: 123,
      succeeded: true,
    });

    expect(notification).toContain("SimplePost demo tool call");
    expect(notification).toContain("Account: openai@simplepost.social");
    expect(notification).toContain("Tool: validate_post");
    expect(notification).toContain('Args: {"content":"Unique review post"}');
    expect(notification).toContain("Result: Success");
    expect(notification).toContain("HTTP: 200 · 123 ms");
    expect(notification).not.toContain("MCP response");
  });

  it("suppresses tracing for the token-bearing Telegram request", async () => {
    const previousToken = process.env.LOG_TELEGRAM_BOT_TOKEN;
    const previousChatId = process.env.LOG_TELEGRAM_CHAT_ID;
    const previousDisabled = process.env.LOG_TELEGRAM_DISABLED;
    const originalFetch = global.fetch;

    process.env.LOG_TELEGRAM_BOT_TOKEN = "test-token";
    process.env.LOG_TELEGRAM_CHAT_ID = "test-chat";
    delete process.env.LOG_TELEGRAM_DISABLED;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    try {
      await sendTelegramLogNotification({
        level: "error",
        message: "Test failure",
        timestamp: "2026-08-20T12:00:00.000Z",
      });

      expect(suppressTracing).toHaveBeenCalledWith({ active: true });
      expect(otelContext.with).toHaveBeenCalledWith({ suppressed: true }, expect.any(Function));
      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-token/sendMessage",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      global.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.LOG_TELEGRAM_BOT_TOKEN;
      else process.env.LOG_TELEGRAM_BOT_TOKEN = previousToken;
      if (previousChatId === undefined) delete process.env.LOG_TELEGRAM_CHAT_ID;
      else process.env.LOG_TELEGRAM_CHAT_ID = previousChatId;
      if (previousDisabled === undefined) delete process.env.LOG_TELEGRAM_DISABLED;
      else process.env.LOG_TELEGRAM_DISABLED = previousDisabled;
    }
  });

  it("sends review exchanges even when normal Telegram logs require errors", async () => {
    const previousToken = process.env.LOG_TELEGRAM_BOT_TOKEN;
    const previousChatId = process.env.LOG_TELEGRAM_CHAT_ID;
    const previousDisabled = process.env.LOG_TELEGRAM_DISABLED;
    const previousMinLevel = process.env.LOG_TELEGRAM_MIN_LEVEL;
    const originalFetch = global.fetch;

    process.env.LOG_TELEGRAM_BOT_TOKEN = "test-token";
    process.env.LOG_TELEGRAM_CHAT_ID = "test-chat";
    process.env.LOG_TELEGRAM_MIN_LEVEL = "fatal";
    delete process.env.LOG_TELEGRAM_DISABLED;
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    try {
      await sendTelegramReviewExchange({
        userEmail: "openai@simplepost.social",
        toolName: "list_accounts",
        arguments: "{}",
        status: 200,
        durationMs: 123,
        succeeded: true,
      });

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.telegram.org/bottest-token/sendMessage",
        expect.objectContaining({ method: "POST" }),
      );
      const request = (global.fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      const body = JSON.parse(request.body as string) as { parse_mode?: string; text: string };
      expect(body.parse_mode).toBeUndefined();
      expect(body.text).toContain("SimplePost demo tool call");
    } finally {
      global.fetch = originalFetch;
      if (previousToken === undefined) delete process.env.LOG_TELEGRAM_BOT_TOKEN;
      else process.env.LOG_TELEGRAM_BOT_TOKEN = previousToken;
      if (previousChatId === undefined) delete process.env.LOG_TELEGRAM_CHAT_ID;
      else process.env.LOG_TELEGRAM_CHAT_ID = previousChatId;
      if (previousDisabled === undefined) delete process.env.LOG_TELEGRAM_DISABLED;
      else process.env.LOG_TELEGRAM_DISABLED = previousDisabled;
      if (previousMinLevel === undefined) delete process.env.LOG_TELEGRAM_MIN_LEVEL;
      else process.env.LOG_TELEGRAM_MIN_LEVEL = previousMinLevel;
    }
  });
});
