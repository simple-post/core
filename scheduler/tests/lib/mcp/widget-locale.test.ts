import { askChat, callTool } from "@/mcp-ui/extensions/host";
import {
  bindWidgetLocale,
  preferredWidgetLocale,
  widgetCopy,
  widgetFallback,
  widgetLocale,
} from "@/mcp-ui/widget-locale";

import type { App } from "@modelcontextprotocol/ext-apps";

jest.mock("@modelcontextprotocol/ext-apps/react", () => ({ useApp: jest.fn(), useHostStyles: jest.fn() }));
jest.mock("@/mcp-ui/use-host-locale", () => ({ useHostLocale: jest.fn() }));

function mockApp(locale: string) {
  const context = { locale };
  const app = {
    getHostContext: () => context,
    callServerTool: jest.fn().mockResolvedValue({ structuredContent: { unchanged: true }, content: [] }),
    getHostCapabilities: () => ({ message: {}, updateModelContext: { structuredContent: true } }),
    updateModelContext: jest.fn(),
    sendMessage: jest.fn(),
  };
  return { app: app as unknown as App, mock: app, context };
}

it("isolates host locales and propagates live locale metadata without changing tool inputs", async () => {
  const a = mockApp("ar");
  const b = mockApp("ja");
  bindWidgetLocale(a.app, "ar", { "The action could not be completed.": "marker-a" });
  bindWidgetLocale(b.app, "ja", { "The action could not be completed.": "marker-b" });
  expect(widgetCopy(a.app)("The action could not be completed.")).toBe("marker-a");
  expect(widgetCopy(b.app)("The action could not be completed.")).toBe("marker-b");
  const args = { postId: "post-42", content: "Unchanged العربية 日本語", postingMode: "draft" };
  await callTool(a.app, "inspect_post", args);
  expect(a.mock.callServerTool).toHaveBeenLastCalledWith({
    name: "inspect_post",
    arguments: args,
    _meta: { "openai/locale": "ar" },
  });
  a.context.locale = "de-DE";
  expect(widgetLocale(a.app)).toBe("de");
  await callTool(a.app, "inspect_post", args);
  expect(a.mock.callServerTool.mock.calls[1][0]._meta["openai/locale"]).toBe("de");
  expect(widgetLocale(b.app)).toBe("ja");
});

it("keeps selected user content exact inside structured and text chat context", async () => {
  const a = mockApp("ar");
  bindWidgetLocale(a.app, "ar", {
    "SimplePost selection: {{selection}}": "selection-marker {{selection}}",
    "Selected SimplePost context: {{selection}}": "context-marker {{selection}}",
  });
  const selection = { postId: "post-1", message: "Private <markup> العربية 日本語" };
  await askChat(a.app, "prompt-marker", selection);
  expect(a.mock.updateModelContext.mock.calls[0][0]).toEqual({
    structuredContent: selection,
    content: [{ type: "text", text: `selection-marker ${JSON.stringify(selection)}` }],
  });
  expect(a.mock.sendMessage.mock.calls[0][0].content[0].text).toBe(
    `prompt-marker\n\ncontext-marker ${JSON.stringify(selection)}`,
  );
});

it("keeps provider detail intact and translates locally authored fallback only", async () => {
  const a = mockApp("ar");
  bindWidgetLocale(a.app, "ar", { "The action could not be completed.": "marker-a" });
  a.mock.callServerTool.mockResolvedValue({
    isError: true,
    content: [{ type: "text", text: "provider-detail\nSIMPLEPOST_ERROR metadata" }],
  } as never);
  await expect(callTool(a.app, "inspect_post")).rejects.toThrow("provider-detail");
  a.mock.callServerTool.mockResolvedValue({ isError: true, content: [] } as never);
  await expect(callTool(a.app, "inspect_post")).rejects.toThrow("marker-a");
  expect(widgetFallback("user text 日本語", (source) => `marker:${source}`)).toBe("user text 日本語");
});

it("prefers explicit host language while retaining the request language when the host omits it", () => {
  expect(preferredWidgetLocale("ja-JP", "de", "ar")).toBe("ja");
  expect(preferredWidgetLocale(undefined, "de", "ar")).toBe("de");
  expect(preferredWidgetLocale(undefined, undefined, "ar")).toBe("ar");
  expect(preferredWidgetLocale("unsupported", undefined, "zh-TW")).toBe("zh-Hant");
});
