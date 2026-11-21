import type { NextRequest } from "next/server";

import { hasMcpScope, type McpScope } from "./config";

/** REST accepts MCP credentials too; it must not bypass narrowed MCP consent. */
export async function allowsMcpRestRequest(req: NextRequest, scope: string): Promise<boolean> {
  const path = req.nextUrl.pathname;
  const required: McpScope[] = [];
  if (["GET", "HEAD"].includes(req.method) && /^\/api\/v1\/accounts(?:\/|$)/.test(path)) {
    required.push("accounts:read");
  } else if (["GET", "HEAD"].includes(req.method) && /^\/api\/v1\/posts(?:\/|$)/.test(path)) {
    required.push("posts:read");
  } else if (req.method === "POST" && path === "/api/v1/validation") {
    required.push("posts:validate");
    // Plain validation is read-only, but image fitting imports and stores media.
    try {
      const body = await req.clone().json();
      if (body?.imageFit) required.push("posts:write");
    } catch {
      return false;
    }
  } else {
    // Preserve existing full-access tokens; deny narrower credentials on every
    // other endpoint, including uploads, settings and account disconnection.
    required.push("posts:write");
  }
  return required.every((permission) => hasMcpScope(scope, permission));
}
