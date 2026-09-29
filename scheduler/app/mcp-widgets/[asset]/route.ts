import { isWidgetName } from "@/lib/mcp/ui/runtime";
import { WIDGET_ASSETS } from "@/lib/mcp/ui/widget-assets";

export const dynamic = "force-dynamic";

// Public files are served first. During a rolling deployment an old runtime may
// reach an instance without its hash; keep the versioned mount contract available.
export async function GET(request: Request, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  const match = /^(workspace|post-editor|schedule|post-preview)-[A-Z0-9]{8}\.(js|css)$/i.exec(asset);
  if (!match || !isWidgetName(match[1])) return new Response("Widget asset not found.", { status: 404 });
  const current = match[2] === "js" ? WIDGET_ASSETS[match[1]].script : WIDGET_ASSETS[match[1]].stylesheet;
  if (current === asset) return new Response("Widget asset not found.", { status: 404 });
  return new Response(null, {
    status: 307,
    headers: {
      Location: new URL(`/mcp-widgets/${current}`, request.url).toString(),
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
