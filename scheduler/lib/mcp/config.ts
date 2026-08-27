import { env } from "@/lib/env";

export const OIDC_SCOPES = ["openid", "email"] as const;
export const MCP_SCOPES = ["accounts:read", "posts:read", "posts:validate", "posts:write"] as const;
export const MCP_AUTHORIZATION_SCOPES = [...OIDC_SCOPES, ...MCP_SCOPES] as const;
export const DEFAULT_MCP_SCOPE = MCP_AUTHORIZATION_SCOPES.join(" ");

export type McpScope = (typeof MCP_SCOPES)[number];
export type McpAuthorizationScope = (typeof MCP_AUTHORIZATION_SCOPES)[number];

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

export function getOidcUserInfoUrl(): string {
  return `${getAppBaseUrl()}/api/oauth/userinfo`;
}

export function getOidcJwksUrl(): string {
  return `${getAppBaseUrl()}/api/oauth/jwks`;
}

export function parseMcpScopes(scope?: string | null): McpScope[] {
  if (!scope?.trim()) return [...MCP_SCOPES];

  const requested = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return requested.filter((item): item is McpScope => MCP_SCOPES.includes(item as McpScope));
}

export function parseMcpAuthorizationScopes(scope?: string | null): McpAuthorizationScope[] {
  if (!scope?.trim()) return [...MCP_AUTHORIZATION_SCOPES];

  const requested = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return requested.filter((item): item is McpAuthorizationScope =>
    MCP_AUTHORIZATION_SCOPES.includes(item as McpAuthorizationScope),
  );
}

export function validateMcpScope(
  scope?: string | null,
): { ok: true; scope: string } | { ok: false; unsupported: string[] } {
  if (!scope?.trim()) return { ok: true, scope: DEFAULT_MCP_SCOPE };

  const requested = scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const unsupported = requested.filter((item) => !MCP_AUTHORIZATION_SCOPES.includes(item as McpAuthorizationScope));

  if (unsupported.length > 0) {
    return { ok: false, unsupported };
  }

  return { ok: true, scope: [...new Set(requested)].join(" ") };
}

export function hasMcpScope(grantedScope: string | null | undefined, requiredScope: McpScope): boolean {
  return parseMcpScopes(grantedScope).includes(requiredScope);
}

export function hasMcpAuthorizationScope(
  grantedScope: string | null | undefined,
  requiredScope: McpAuthorizationScope,
): boolean {
  return parseMcpAuthorizationScopes(grantedScope).includes(requiredScope);
}

export function isMcpScopeSubset(requestedScope: string, allowedScope?: string | null): boolean {
  const allowed = new Set(parseMcpAuthorizationScopes(allowedScope));
  return parseMcpAuthorizationScopes(requestedScope).every((scope) => allowed.has(scope));
}

export function canUpgradeLegacyMcpClientScope(requestedScope: string, registeredScope?: string | null): boolean {
  const registered = new Set(parseMcpAuthorizationScopes(registeredScope));
  const requested = parseMcpAuthorizationScopes(requestedScope);
  const missing = requested.filter((scope) => !registered.has(scope));

  if (missing.length === 0 || missing.some((scope) => !["openid", "email", "posts:read"].includes(scope))) {
    return false;
  }

  return (
    !missing.includes("posts:read") ||
    (registered.has("accounts:read") && registered.has("posts:validate") && registered.has("posts:write"))
  );
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
  return isLoopback && parsed.protocol === "http:";
}
