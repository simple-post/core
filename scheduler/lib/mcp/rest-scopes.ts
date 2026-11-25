import type { NextRequest } from "next/server";

import { hasMcpScope, type McpScope } from "./config";

const READ_ONLY_WORKSPACE_PATHS = new Set([
  "/api/v1/features",
  "/api/v1/posting-slots",
  "/api/v1/publishing-preferences",
]);

export function socialInboxRestScope(req: NextRequest): McpScope | undefined {
  const path = req.nextUrl.pathname;
  if (!path.startsWith("/api/v1/social/")) return undefined;
  return path === "/api/v1/social/inbox" && ["GET", "HEAD"].includes(req.method) ? "posts:read" : "posts:write";
}

/** REST accepts MCP credentials too; it must not bypass narrowed MCP consent. */
export async function allowsMcpRestRequest(req: NextRequest, scope: string): Promise<boolean> {
  const inboxScope = socialInboxRestScope(req);
  if (inboxScope) return hasMcpScope(scope, inboxScope);
  const path = req.nextUrl.pathname;
  const required: McpScope[] = [];
  const isRead = ["GET", "HEAD"].includes(req.method);
  if (isRead && /^\/api\/v1\/accounts(?:\/|$)/.test(path)) {
    required.push("accounts:read");
  } else if (isRead && /^\/api\/v1\/posts(?:\/|$)/.test(path)) {
    required.push("posts:read");
  } else if (isRead && READ_ONLY_WORKSPACE_PATHS.has(path)) {
    // Side-effect-free workspace settings used to plan and inspect schedules.
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
