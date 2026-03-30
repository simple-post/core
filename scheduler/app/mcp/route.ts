import { type NextRequest } from "next/server";
import { createMcpHandler } from "mcp-handler";

import { authenticateMcpToken, isMcpToken } from "@/lib/mcp/oauth";
import { registerTools } from "@/lib/mcp/server";
import { env } from "@/lib/env";

const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

/**
 * Extract and authenticate the MCP bearer token from the request.
 * Returns the user ID if valid, or null.
 */
async function authenticateRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);
  if (!isMcpToken(token)) return null;

  const session = await authenticateMcpToken(token);
  return session?.user?.id ?? null;
}

/**
 * Build a 401 response with WWW-Authenticate header pointing to resource metadata.
 */
function unauthorizedResponse(): Response {
  const baseUrl = env.NEXT_PUBLIC_APP_URL;
  const resourceMetadataUrl = `${baseUrl}${RESOURCE_METADATA_PATH}`;

  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}"`,
      "Content-Type": "application/json",
    },
  });
}

/**
 * POST /mcp — Handle MCP JSON-RPC requests via Streamable HTTP.
 */
export async function POST(req: NextRequest) {
  const userId = await authenticateRequest(req);
  if (!userId) {
    return unauthorizedResponse();
  }

  const handler = createMcpHandler(
    (server) => registerTools(server, userId),
    { serverInfo: { name: "SimplePost", version: "1.0.0" } },
    { basePath: "/mcp" },
  );

  return handler(req);
}

/**
 * GET /mcp — SSE endpoint (not used in stateless mode).
 */
export async function GET(req: NextRequest) {
  const userId = await authenticateRequest(req);
  if (!userId) {
    return unauthorizedResponse();
  }

  return new Response(JSON.stringify({ error: "Method not allowed. Use POST for MCP requests." }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * DELETE /mcp — Session termination (no-op in stateless mode).
 */
export async function DELETE() {
  return new Response(null, { status: 204 });
}
