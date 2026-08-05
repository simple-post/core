import { transform } from "esbuild";

import { GET } from "@/app/mcp-ui/runtime.js/route";
import { WIDGET_ASSETS } from "@/lib/mcp/ui/widget-assets";

describe("MCP widget live runtime route", () => {
  const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = "https://dev.simplepost.social/";
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
  });

  it.each([
    ["schedule", WIDGET_ASSETS.schedule.script, WIDGET_ASSETS.schedule.stylesheet, "mountScheduleWidget"],
    [
      "post-preview",
      WIDGET_ASSETS["post-preview"].script,
      WIDGET_ASSETS["post-preview"].stylesheet,
      "mountPostPreviewWidget",
    ],
  ])("serves a parseable no-cache %s runtime", async (mode, scriptAsset, stylesheetAsset, mountExport) => {
    const response = GET(new Request(`https://dev.simplepost.social/mcp-ui/runtime.js?mode=${mode}&mount=test-1`));
    const source = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("cross-origin");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(source).toContain(`https://dev.simplepost.social/mcp-widgets/${scriptAsset}`);
    expect(source).toContain(`https://dev.simplepost.social/mcp-widgets/${stylesheetAsset}`);
    expect(source).toContain(mountExport);
    expect(source).not.toContain("test-better-auth-secret");
    await expect(transform(source, { format: "esm", loader: "js", target: "es2022" })).resolves.toBeDefined();
  });

  it("rejects unknown modes and missing mount identifiers", async () => {
    const unknown = GET(new Request("https://dev.simplepost.social/mcp-ui/runtime.js?mode=unknown&mount=test-1"));
    const missingMount = GET(new Request("https://dev.simplepost.social/mcp-ui/runtime.js?mode=schedule"));

    expect(unknown.status).toBe(400);
    expect(await unknown.text()).toContain("Unknown SimplePost widget mode");
    expect(missingMount.status).toBe(400);
    expect(await missingMount.text()).toContain("mount identifier");
  });
});
