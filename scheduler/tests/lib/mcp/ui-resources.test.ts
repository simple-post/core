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
  it("registers self-contained schedule and preview app shells", async () => {
    const registerResource = jest.fn();
    registerMcpUiResources({ registerResource } as unknown as McpServer);

    expect(registerResource).toHaveBeenCalledTimes(2);
    expect(registerResource.mock.calls.map((call) => call[1])).toEqual([SCHEDULE_WIDGET_URI, POST_PREVIEW_WIDGET_URI]);

    const callbacks = registerResource.mock.calls.map((call) => call[3] as () => Promise<ResourceResult>);
    const [schedule, preview] = await Promise.all(callbacks.map((callback) => callback()));

    expect(schedule.contents[0]).toEqual(
      expect.objectContaining({
        uri: SCHEDULE_WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining("/mcp-widgets/schedule.js"),
      }),
    );
    expect(schedule.contents[0].text).toContain("/mcp-widgets/schedule.css");
    expect(preview.contents[0]).toEqual(
      expect.objectContaining({
        uri: POST_PREVIEW_WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: expect.stringContaining("/mcp-widgets/post-preview.js"),
      }),
    );
    expect(preview.contents[0].text).toContain("/mcp-widgets/post-preview.css");
    expect(preview.contents[0]._meta?.ui?.csp?.resourceDomains).toContain("https://*.simplepost.social");
  });
});
