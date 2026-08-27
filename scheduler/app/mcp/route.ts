import { after, type NextRequest } from "next/server";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { assertActiveSubscription } from "@/lib/billing/subscriptions";
import { createLogger, serializeError } from "@/lib/logger";
import { DEFAULT_MCP_SCOPE, getAppBaseUrl, getMcpResourceUrl } from "@/lib/mcp/config";
import { authenticateMcpToken, isMcpToken } from "@/lib/mcp/oauth";
import { logReviewMcpExchange, shouldLogReviewMcpExchange } from "@/lib/mcp/review-logging";
import { registerTools, SERVER_INSTRUCTIONS, type McpToolAuthContext } from "@/lib/mcp/server";
import { apiErrorLogPayload, PaymentRequiredError } from "@/lib/utils/errors";

const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
const log = createLogger("api:mcp");

/**
 * Extract and authenticate the MCP bearer token from the request.
 * Returns the user ID if valid, or null.
 */
async function authenticateRequest(req: Request): Promise<McpToolAuthContext | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length);
  if (!isMcpToken(token)) return null;

  const session = await authenticateMcpToken(token, getMcpResourceUrl());
  if (!session?.user?.id) return null;

  await assertActiveSubscription(session.user.id, { action: "mcp_request" });

  return {
    userId: session.user.id,
    userEmail: session.user.email,
    scope: session.session.scope,
  };
}

/**
 * Build a 401 response with WWW-Authenticate header pointing to resource metadata.
 */
function unauthorizedResponse(): Response {
  const baseUrl = getAppBaseUrl();
  const resourceMetadataUrl = `${baseUrl}${RESOURCE_METADATA_PATH}`;

  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl}", scope="${DEFAULT_MCP_SCOPE}"`,
      "Content-Type": "application/json",
    },
  });
}

function paymentRequiredResponse(): Response {
  return new Response(JSON.stringify({ error: "subscription_required" }), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

async function getAuthContextOrResponse(req: Request): Promise<McpToolAuthContext | Response | null> {
  try {
    return await authenticateRequest(req);
  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      log.warn(apiErrorLogPayload(error), "MCP billing gate denied");
      return paymentRequiredResponse();
    }
    throw error;
  }
}

/**
 * Handle an MCP request using the SDK's WebStandardStreamableHTTPServerTransport.
 * Creates a fresh server + transport per request (stateless mode).
 */
async function handleMcpRequest(req: Request, authContext: McpToolAuthContext): Promise<Response> {
  const server = new McpServer(
    {
      name: "SimplePost",
      version: "1.0.0",
    },
    {
      instructions: SERVER_INSTRUCTIONS,
    },
  );
  registerTools(server, authContext);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  await server.connect(transport);

  return transport.handleRequest(req);
}

async function recordReviewExchange(
  authContext: McpToolAuthContext,
  requestBody: Promise<string> | undefined,
  responseBody: Promise<string>,
  responseStatus: number,
  requestId: string,
  startedAt: number,
): Promise<void> {
  if (!requestBody) return;

  try {
    const [resolvedRequestBody, resolvedResponseBody] = await Promise.all([requestBody, responseBody]);
    await logReviewMcpExchange({
      auth: authContext,
      requestBody: resolvedRequestBody,
      responseBody: resolvedResponseBody,
      requestId,
      status: responseStatus,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    log.error(
      { err: serializeError(error), requestId, userId: authContext.userId },
      "Failed to record review MCP exchange",
    );
  }
}

function scheduleReviewExchange(
  authContext: McpToolAuthContext,
  requestBody: Promise<string> | undefined,
  response: Response,
  requestId: string,
  startedAt: number,
): void {
  if (!requestBody) return;

  const responseBody = response.clone().text();
  after(() => recordReviewExchange(authContext, requestBody, responseBody, response.status, requestId, startedAt));
}

/**
 * POST /mcp — Handle MCP JSON-RPC requests via Streamable HTTP.
 */
export async function POST(req: NextRequest) {
  const authContext = await getAuthContextOrResponse(req);
  if (authContext instanceof Response) {
    return authContext;
  }
  if (!authContext) {
    return unauthorizedResponse();
  }

  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  // Clone before the MCP transport consumes the body. The server boundary only
  // contains JSON-RPC tool payloads, not the complete ChatGPT conversation.
  const reviewRequestBody = shouldLogReviewMcpExchange(authContext) ? req.clone().text() : undefined;

  try {
    const response = await handleMcpRequest(req, authContext);
    scheduleReviewExchange(authContext, reviewRequestBody, response, requestId, startedAt);
    return response;
  } catch (error) {
    log.error({ err: serializeError(error), userId: authContext.userId }, "MCP request error");
    const response = new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32_603, message: error instanceof Error ? error.message : "Internal error" },
        id: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
    scheduleReviewExchange(authContext, reviewRequestBody, response, requestId, startedAt);
    return response;
  }
}

/**
 * GET /mcp — SSE endpoint (not used in stateless mode).
 */
export async function GET(req: NextRequest) {
  const authContext = await getAuthContextOrResponse(req);
  if (authContext instanceof Response) {
    return authContext;
  }
  if (!authContext) {
    return unauthorizedResponse();
  }

  return new Response(JSON.stringify({ error: "SSE not supported. Use POST for MCP requests." }), {
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
