import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { registerLanguageTools } from "@/lib/mcp/language-tools";
import { withMcpLocale, mcpUiTranslation } from "@/lib/mcp/locale";
import { registerMeasuredTool } from "@/lib/mcp/registration";
import { prisma } from "@/lib/prisma";
import { acceptWidgetLanguage, effectiveWidgetLocale, pluginLanguage } from "@/mcp-ui/widget-locale";

import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult, McpServer, StandardSchemaWithJSON } from "@modelcontextprotocol/server";

const saved = new Map<string, string | null>();
jest.mock("@modelcontextprotocol/ext-apps/server", () => ({ registerAppTool: jest.fn() }));
jest.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: jest.fn(), update: jest.fn() } } }));
jest.mock("@/lib/analytics/events", () => ({
  recordFunnelEvent: jest.fn(),
  measurementFailure: () => "unknown_error",
}));
beforeEach(() => {
  saved.clear();
  jest.clearAllMocks();
  jest.mocked(prisma.user.findUnique).mockImplementation((async ({ where }: { where: { id: string } }) => ({
    pluginLocale: saved.get(where.id) ?? null,
  })) as never);
  jest.mocked(prisma.user.update).mockImplementation((async ({
    where,
    data,
  }: {
    where: { id: string };
    data: { pluginLocale: string | null };
  }) => {
    saved.set(where.id, data.pluginLocale);
    return data;
  }) as never);
});
function registered(userId: string, scope = "posts:read posts:write") {
  jest.mocked(registerAppTool).mockClear();
  registerLanguageTools({ registerTool: jest.fn() } as unknown as McpServer, { userId, scope, uiLocale: "en" });
  const calls = [...jest.mocked(registerAppTool).mock.calls];
  return async (name: string, input: object, locale = "en") => {
    const entry = calls.find((call) => call[1] === name)!;
    const config = entry[2],
      handler = entry[3];
    const parsed = await (config.inputSchema as StandardSchemaWithJSON)["~standard"].validate(input);
    if (parsed.issues) throw new Error("Invalid input");
    return await (handler as (...args: unknown[]) => Promise<CallToolResult>)(parsed.value, {
      mcpReq: { _meta: { "openai/locale": locale } },
    });
  };
}
it("isolates persisted preferences by authenticated account and resets Automatic to the client", async () => {
  const a = registered("a"),
    b = registered("b");
  expect(await a("set_plugin_language", { language: "it" })).toMatchObject({ _meta: { "simplepost/uiLocale": "it" } });
  expect(await b("get_language_settings", {}, "bg")).toMatchObject({
    structuredContent: { language: "auto", resolvedLocale: "bg" },
  });
  const request = await a("get_language_settings", { response_locale: "bg" }, "ar");
  expect(request.structuredContent).toEqual({ language: "it", resolvedLocale: "bg" });
  expect(request.content.at(-1)).toEqual({ type: "text", text: JSON.stringify({ resolvedLocale: "bg" }) });
  expect(saved.get("a")).toBe("it");
  expect(await a("set_plugin_language", { language: "auto" }, "ja")).toMatchObject({
    _meta: { "simplepost/uiLocale": "ja" },
  });
  expect(saved.get("a")).toBeNull();
});
it("retains scope guards and rejects unsupported languages without writing", async () => {
  const readOnly = registered("a", "posts:read");
  expect(await readOnly("set_plugin_language", { language: "it" })).toHaveProperty("isError", true);
  expect(prisma.user.update).not.toHaveBeenCalled();
  await expect(readOnly("set_plugin_language", { language: "xx" })).rejects.toThrow("Invalid input");
  await expect(readOnly("get_language_settings", { response_locale: "xx" })).rejects.toThrow("Invalid input");
});
it("keeps strict schemas, transforms and mixed-language user data intact across concurrent requests", async () => {
  const handler = jest.fn(async (input: { message: string }) => {
    await Promise.resolve();
    return {
      content: [{ type: "text" as const, text: input.message }],
      structuredContent: { message: input.message, observed: mcpUiTranslation().locale },
    };
  });
  await withMcpLocale("en", () =>
    registerMeasuredTool(
      { userId: "a" },
      { registerTool: jest.fn() },
      "fixture",
      { inputSchema: z.object({ message: z.string().transform((v) => v.trim()) }).strict(), _meta: {} },
      handler,
    ),
  );
  const call = jest.mocked(registerAppTool).mock.calls[0];
  const schema = call[2].inputSchema as StandardSchemaWithJSON;
  expect(await schema["~standard"].validate({ message: "hi", extra: true })).toHaveProperty("issues");
  const first = await schema["~standard"].validate({ message: "  My workout 日本語  ", response_locale: "bg" });
  const callback = call[3] as (...args: unknown[]) => Promise<CallToolResult>;
  const [bg, ar] = await Promise.all([
    callback("value" in first ? first.value : {}, {}),
    callback({ message: "Записки", response_locale: "ar" }, {}),
  ]);
  expect(bg.structuredContent).toEqual({ message: "My workout 日本語", observed: "bg" });
  expect(ar.structuredContent).toEqual({ message: "Записки", observed: "ar" });
  expect(handler.mock.calls[0][0]).not.toHaveProperty("response_locale");
  const legacy = await callback({ message: "unchanged" }, { mcpReq: { _meta: { "webplus/i18n": "it-IT" } } });
  expect(legacy._meta?.["simplepost/uiLocale"]).toBe("it");
});
it("keeps a widget language override ahead of host updates and allows returning to Automatic", () => {
  const context = { locale: "en" },
    app = { getHostContext: () => context } as unknown as App;
  acceptWidgetLanguage(app, { "simplepost/uiLocale": "it", "simplepost/pluginLanguage": "it" });
  context.locale = "ar";
  expect(effectiveWidgetLocale(app)).toBe("it");
  acceptWidgetLanguage(app, {
    "simplepost/uiLocale": "bg",
    "simplepost/pluginLanguage": "it",
    "simplepost/responseLocale": "bg",
  });
  expect(effectiveWidgetLocale(app)).toBe("bg");
  acceptWidgetLanguage(app, { "simplepost/uiLocale": "ar", "simplepost/pluginLanguage": "auto" });
  expect(pluginLanguage(app)).toBe("auto");
  context.locale = "de";
  expect(effectiveWidgetLocale(app)).toBe("de");
});
