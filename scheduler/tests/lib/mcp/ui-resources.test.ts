jest.mock("@modelcontextprotocol/ext-apps/server", () => ({
  RESOURCE_MIME_TYPE: "text/html;profile=mcp-app",
  registerAppResource: (
    server: { registerResource: (...arguments_: unknown[]) => unknown },
    name: string,
    uri: string,
    config: Record<string, unknown>,
    callback: () => Promise<unknown>,
  ) => server.registerResource(name, uri, { mimeType: "text/html;profile=mcp-app", ...config }, callback),
}));

import {
  LEGACY_SCHEDULE_WIDGET_URIS,
  POST_PREVIEW_WIDGET_URI,
  registerMcpUiResources,
  SCHEDULE_WIDGET_URI,
} from "@/lib/mcp/ui/resources";
import { WIDGET_RUNTIME_PATH, WIDGET_RUNTIME_TIMEOUT_MS } from "@/lib/mcp/ui/runtime";
import { WIDGET_ASSETS } from "@/lib/mcp/ui/widget-assets";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type ResourceResult = {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
    _meta?: {
      ui?: {
        domain?: string;
        csp?: {
          resourceDomains?: string[];
        };
      };
      "openai/widgetDomain"?: string;
    };
  }>;
};

describe("MCP UI resources", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://dev.simplepost.social/";
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it("builds widget assets explicitly in scheduler build commands", () => {
    const packageJson = jest.requireActual("../../../package.json") as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toMatch(/^yarn build:mcp-widgets && next build/);
    expect(packageJson.scripts.dev).toMatch(/^yarn build:mcp-widgets && next dev/);
    expect(packageJson.scripts.prebuild).toBeUndefined();
    expect(packageJson.scripts.predev).toBeUndefined();
  });

  it("registers self-contained schedule and preview app shells", async () => {
    const registerResource = jest.fn();
    registerMcpUiResources({ registerResource } as unknown as McpServer);

    expect(SCHEDULE_WIDGET_URI).toMatch(/^ui:\/\/simplepost\/schedule-v\d+\.html$/);
    expect(POST_PREVIEW_WIDGET_URI).toBe("ui://simplepost/post-preview-v1.html");
    expect(WIDGET_ASSETS.schedule.script).toMatch(/^schedule-[A-Z0-9]+\.js$/);
    expect(WIDGET_ASSETS.schedule.stylesheet).toMatch(/^schedule-[A-Z0-9]+\.css$/);
    expect(WIDGET_ASSETS["post-preview"].script).toMatch(/^post-preview-[A-Z0-9]+\.js$/);
    expect(WIDGET_ASSETS["post-preview"].stylesheet).toMatch(/^post-preview-[A-Z0-9]+\.css$/);
    expect(registerResource.mock.calls.map((call) => call[1])).toEqual([
      SCHEDULE_WIDGET_URI,
      ...LEGACY_SCHEDULE_WIDGET_URIS,
      POST_PREVIEW_WIDGET_URI,
    ]);
    for (const call of registerResource.mock.calls) {
      const config = call[2] as {
        _meta?: { ui?: { domain?: string }; "openai/widgetDomain"?: string };
        mimeType?: string;
      };
      expect(config.mimeType).toBe("text/html;profile=mcp-app");
      expect(config._meta?.ui?.domain).toBeUndefined();
      expect(config._meta?.["openai/widgetDomain"]).toBe("https://dev.simplepost.social");
    }

    const resources = await Promise.all(
      registerResource.mock.calls.map((call) => {
        const uri = call[1] as string;
        const callback = call[3] as (requestedUri: URL) => Promise<ResourceResult>;
        return callback(new URL(uri));
      }),
    );
    const resourceByUri = new Map(resources.map((resource) => [resource.contents[0].uri, resource]));
    const schedule = resourceByUri.get(SCHEDULE_WIDGET_URI);
    const preview = resourceByUri.get(POST_PREVIEW_WIDGET_URI);

    expect(schedule?.contents[0]).toEqual(
      expect.objectContaining({
        uri: SCHEDULE_WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining(`${WIDGET_RUNTIME_PATH}?mode=schedule`),
      }),
    );
    expect(schedule?.contents[0].text).toContain("Date.now().toString(36)");
    expect(schedule?.contents[0].text).toContain("Math.random().toString(36)");
    expect(schedule?.contents[0].text).toContain(`}, ${WIDGET_RUNTIME_TIMEOUT_MS});`);
    expect(schedule?.contents[0].text).toContain("Retry");
    expect(schedule?.contents[0].text).not.toContain('addEventListener("message"');
    expect(schedule?.contents[0].text).not.toContain(WIDGET_ASSETS.schedule.script);
    expect(schedule?.contents[0].text).not.toContain(WIDGET_ASSETS.schedule.stylesheet);
    expect(schedule?.contents[0]._meta?.ui?.domain).toBeUndefined();
    expect(schedule?.contents[0]._meta?.["openai/widgetDomain"]).toBe("https://dev.simplepost.social");
    expect(schedule?.contents[0]._meta?.ui?.csp?.resourceDomains).toContain("https://dev.simplepost.social");
    expect(preview?.contents[0]).toEqual(
      expect.objectContaining({
        uri: POST_PREVIEW_WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining(`${WIDGET_RUNTIME_PATH}?mode=post-preview`),
      }),
    );
    expect(preview?.contents[0].text).not.toContain(WIDGET_ASSETS["post-preview"].script);
    expect(preview?.contents[0].text).not.toContain(WIDGET_ASSETS["post-preview"].stylesheet);
    expect(preview?.contents[0]._meta?.ui?.domain).toBeUndefined();
    expect(preview?.contents[0]._meta?.["openai/widgetDomain"]).toBe("https://dev.simplepost.social");
    expect(preview?.contents[0]._meta?.ui?.csp?.resourceDomains).toContain("https://*.simplepost.social");
    expect(preview?.contents[0]._meta?.ui?.csp?.resourceDomains).toEqual(
      expect.arrayContaining([
        "https://pbs.twimg.com",
        "https://media.licdn.com",
        "https://media.licdn-ei.com",
        "https://*.fbcdn.net",
        "https://*.fbsbx.com",
        "https://*.cdninstagram.com",
        "https://*.googleusercontent.com",
        "https://*.ggpht.com",
        "https://*.tiktokcdn.com",
        "https://*.tiktokcdn-us.com",
        "https://*.tiktokcdn-eu.com",
        "https://cdn.bsky.app",
        "https://*.pinimg.com",
        "https://dev.to",
        "https://*.dev.to",
        "https://res.cloudinary.com",
      ]),
    );
    expect(preview?.contents[0].text).not.toContain("schedule.simplepost.dev");

    for (const legacyUri of LEGACY_SCHEDULE_WIDGET_URIS) {
      const legacy = resourceByUri.get(legacyUri);
      expect(legacy?.contents[0]).toEqual(
        expect.objectContaining({
          uri: legacyUri,
          mimeType: "text/html;profile=mcp-app",
          text: expect.stringContaining(`${WIDGET_RUNTIME_PATH}?mode=schedule`),
        }),
      );
    }
  });
});
