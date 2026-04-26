import { env } from "@/lib/env";

export const MCP_SCOPES = ["accounts:read", "posts:validate", "posts:write"] as const;
export const DEFAULT_MCP_SCOPE = MCP_SCOPES.join(" ");

export type McpScope = (typeof MCP_SCOPES)[number];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function getAppBaseUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
}

export function getMcpResourceUrl(): string {
  return `${getAppBaseUrl()}/mcp`;
}

export function getMcpDocumentationUrl(): string {
  return `${getAppBaseUrl()}/mcp-docs`;
}

export function parseMcpScopes(scope?: string | null): McpScope[] {
  if (!scope?.trim()) return [...MCP_SCOPES];

  const requested = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return requested.filter((item): item is McpScope => MCP_SCOPES.includes(item as McpScope));
}

export function validateMcpScope(
  scope?: string | null,
): { ok: true; scope: string } | { ok: false; unsupported: string[] } {
  if (!scope?.trim()) return { ok: true, scope: DEFAULT_MCP_SCOPE };

  const requested = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const unsupported = requested.filter((item) => !MCP_SCOPES.includes(item as McpScope));

  if (unsupported.length > 0) {
    return { ok: false, unsupported };
  }

  return { ok: true, scope: [...new Set(requested)].join(" ") };
}

export function hasMcpScope(grantedScope: string | null | undefined, requiredScope: McpScope): boolean {
  return parseMcpScopes(grantedScope).includes(requiredScope);
}

export function isMcpScopeSubset(requestedScope: string, allowedScope?: string | null): boolean {
  const allowed = new Set(parseMcpScopes(allowedScope));
  return parseMcpScopes(requestedScope).every((scope) => allowed.has(scope));
}

export function resolveMcpResource(resource?: string | null): string {
  const expectedResource = getMcpResourceUrl();
  if (!resource?.trim()) return expectedResource;
  if (resource === expectedResource) return resource;

  throw new Error(`Unsupported MCP resource: ${resource}`);
}

export function isAllowedMcpRedirectUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.hash) return false;

  if (parsed.protocol === "https:") {
    return true;
  }

  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname) || LOOPBACK_HOSTS.has(parsed.host);
  return process.env.NODE_ENV !== "production" && isLoopback && parsed.protocol === "http:";
}
