/**
 * RFC 9728 path-insertion variant for the /mcp resource.
 * Clients that derive metadata by inserting /.well-known/oauth-protected-resource
 * before the resource path land here; serve the same document as the root route.
 */
export { GET } from "../route";
