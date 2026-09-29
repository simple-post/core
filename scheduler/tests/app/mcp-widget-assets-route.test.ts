import { GET } from "@/app/mcp-widgets/[asset]/route";
import { WIDGET_ASSETS } from "@/lib/mcp/ui/widget-assets";

it.each(["schedule", "post-preview", "workspace", "post-editor"] as const)(
  "recovers a missing %s hash during rolling deployment",
  async (name) => {
    const asset = `${name}-OLDHASH1.js`;
    const response = await GET(new Request(`https://app.simplepost.social/mcp-widgets/${asset}`), {
      params: Promise.resolve({ asset }),
    });
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://app.simplepost.social/mcp-widgets/${WIDGET_ASSETS[name].script}`,
    );
    expect(response.headers.get("cache-control")).toContain("no-store");
  },
);
it("does not redirect a missing current asset back to itself", async () => {
  const asset = WIDGET_ASSETS.workspace.stylesheet;
  const response = await GET(new Request(`https://app.simplepost.social/mcp-widgets/${asset}`), {
    params: Promise.resolve({ asset }),
  });
  expect(response.status).toBe(404);
});
it("rejects unrelated paths", async () => {
  const response = await GET(new Request("https://app.simplepost.social/mcp-widgets/unknown.js"), {
    params: Promise.resolve({ asset: "unknown.js" }),
  });
  expect(response.status).toBe(404);
});
