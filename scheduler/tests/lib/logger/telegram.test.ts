import { context as otelContext } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";

import { formatTelegramReviewExchange, sendTelegramReviewExchange } from "@/lib/logger/telegram";

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
      await sendTelegramReviewExchange({
        userEmail: "review@example.com",
        toolName: "list_accounts",
        arguments: "{}",
        status: 200,
        durationMs: 10,
        succeeded: true,
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
