import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerTools, SERVER_INSTRUCTIONS, IMAGE_FITTING_INSTRUCTIONS } from "@/lib/mcp/server";

jest.mock("@modelcontextprotocol/ext-apps/server", () => ({ registerAppTool: jest.fn() }));
jest.mock("@/lib/mcp/ui/resources", () => ({ registerMcpUiResources: jest.fn() }));

it.each([undefined, false, true])("advertises image fitting only with a grant (%s)", (enabled) => {
  jest.mocked(registerAppTool).mockClear();
  const server = new McpServer({ name: "test", version: "1" });
  registerTools(server, { userId: "user", imageFittingEnabled: enabled });
  const calls = jest.mocked(registerAppTool).mock.calls;
  for (const name of ["validate_post", "preview_post", "create_post", "update_scheduled_post"]) {
    const config = calls.find((call) => call[1] === name)![2];
    expect(Object.hasOwn(config.inputSchema!, "imageFit")).toBe(!!enabled);
    if (!enabled) expect(config.description).not.toContain("imageFit");
    if (name === "validate_post" || name === "preview_post") {
      expect(config.annotations?.readOnlyHint).toBe(!enabled);
    }
  }
  expect(SERVER_INSTRUCTIONS).not.toContain("imageFit");
  expect(IMAGE_FITTING_INSTRUCTIONS).toContain("imageFit");
});
