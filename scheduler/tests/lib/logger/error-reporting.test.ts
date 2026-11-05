import { flushErrorReports, withErrorContext } from "@/lib/error-reporting";

const mockHook = jest.fn();
jest.mock("pino", () => {
  const factory = Object.assign(
    jest.fn((options) => {
      mockHook.mockImplementation(options.hooks.logMethod);
      return { child: jest.fn(() => ({})) };
    }),
    {
      levels: { values: { error: 50, fatal: 60 } },
      stdSerializers: { err: (error: unknown) => error },
      stdTimeFunctions: { isoTime: jest.fn() },
    },
  );
  return { __esModule: true, default: factory };
});

describe("Pino error report integration", () => {
  it("exports one human-readable record with full diagnostics and sends its summary to Telegram", async () => {
    const originalEnv = { ...process.env };
    process.env.LOG_TELEGRAM_BOT_TOKEN = "test-token";
    process.env.LOG_TELEGRAM_CHAT_ID = "test-chat";
    delete process.env.LOG_TELEGRAM_DISABLED;
    const fetcher = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"ok":true}'));
    try {
      await import("@/lib/logger");
      const write = jest.fn();
      const error = new Error("Provider unavailable");
      withErrorContext({ userEmail: "user@example.com", country: "GR", surface: "mcp" }, () => {
        mockHook.call({ bindings: () => ({ module: "posting" }) }, [{ err: error }, "Publish failed"], write, 50);
      });
      await flushErrorReports();
      expect(write).toHaveBeenCalledTimes(1);
      const [attributes, summary] = write.mock.calls[0];
      expect(attributes["exception.stacktrace"]).toBe(error.stack);
      expect(summary).toContain("user@example.com");
      expect(summary).toContain("Provider unavailable");
      expect(summary).not.toContain("at Object");
      expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text).toBe(summary);
    } finally {
      process.env = originalEnv;
      fetcher.mockRestore();
    }
  });
});
