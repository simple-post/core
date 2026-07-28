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

import { POST_PREVIEW_WIDGET_URI, registerMcpUiResources, SCHEDULE_WIDGET_URI } from "@/lib/mcp/ui/resources";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type ResourceResult = {
  contents: Array<{
    uri: string;
    mimeType: string;
    text: string;
    _meta?: {
      ui?: {
        csp?: {
          resourceDomains?: string[];
        };
      };
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
    expect(POST_PREVIEW_WIDGET_URI).toMatch(/^ui:\/\/simplepost\/post-preview-v\d+\.html$/);
    expect(registerResource.mock.calls.map((call) => call[1])).toEqual([SCHEDULE_WIDGET_URI, POST_PREVIEW_WIDGET_URI]);

    const callbacks = registerResource.mock.calls.map((call) => call[3] as () => Promise<ResourceResult>);
    const resources = await Promise.all(callbacks.map((callback) => callback()));
    const resourceByUri = new Map(resources.map((resource) => [resource.contents[0].uri, resource]));
    const schedule = resourceByUri.get(SCHEDULE_WIDGET_URI);
    const preview = resourceByUri.get(POST_PREVIEW_WIDGET_URI);

    expect(schedule?.contents[0]).toEqual(
      expect.objectContaining({
        uri: SCHEDULE_WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining("/mcp-widgets/schedule.js"),
      }),
    );
    expect(schedule?.contents[0].text).toContain("/mcp-widgets/schedule.css");
    expect(schedule?.contents[0].text).toContain('src="https://dev.simplepost.social/mcp-widgets/schedule.js"');
    expect(schedule?.contents[0].text).toContain('href="https://dev.simplepost.social/mcp-widgets/schedule.css"');
    expect(schedule?.contents[0]._meta?.ui?.csp?.resourceDomains).toContain("https://dev.simplepost.social");
    expect(preview?.contents[0]).toEqual(
      expect.objectContaining({
        uri: POST_PREVIEW_WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining("/mcp-widgets/post-preview.js"),
      }),
    );
    expect(preview?.contents[0].text).toContain("/mcp-widgets/post-preview.css");
    expect(preview?.contents[0].text).toMatch(/\/mcp-widgets\/post-preview\.js\?v=\d+/);
    expect(preview?.contents[0].text).toMatch(/\/mcp-widgets\/post-preview\.css\?v=\d+/);
    expect(preview?.contents[0]._meta?.ui?.csp?.resourceDomains).toContain("https://*.simplepost.social");
    expect(preview?.contents[0].text).not.toContain("schedule.simplepost.dev");
  });
});
