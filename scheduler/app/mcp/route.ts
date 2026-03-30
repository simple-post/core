import { type NextRequest } from "next/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { IncomingMessage, ServerResponse } from "node:http";
import { Readable, Writable } from "node:stream";
import { Socket } from "node:net";

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
 * Create a mock Node.js IncomingMessage from a Web API Request.
 */
function toIncomingMessage(req: Request, body: string): IncomingMessage {
  const readable = Readable.from(Buffer.from(body));
  const socket = new Socket();
  const incoming = new IncomingMessage(socket);
  incoming.method = req.method;
  incoming.url = new URL(req.url).pathname;
  incoming.headers = {};
  req.headers.forEach((value, key) => {
    incoming.headers[key.toLowerCase()] = value;
  });
  // Push the body data
  incoming.push(Buffer.from(body));
  incoming.push(null);
  return incoming;
}

/**
 * Create a mock Node.js ServerResponse and capture the output.
 */
function createCapturedResponse(): {
  res: ServerResponse;
  getResult: () => Promise<{ status: number; headers: Record<string, string>; body: string }>;
} {
  const chunks: Buffer[] = [];
  let statusCode = 200;
  let headers: Record<string, string> = {};
  let resolvePromise: (value: { status: number; headers: Record<string, string>; body: string }) => void;
  const resultPromise = new Promise<{ status: number; headers: Record<string, string>; body: string }>(
    (resolve) => { resolvePromise = resolve; },
  );

  const socket = new Socket();
  const incoming = new IncomingMessage(socket);
  const res = new ServerResponse(incoming);

  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = function (code: number, ...args: unknown[]) {
    statusCode = code;
    // Handle the different overload signatures
    const headersArg = args.length === 1 ? args[0] : args.length === 2 ? args[1] : undefined;
    if (headersArg && typeof headersArg === "object") {
      for (const [key, value] of Object.entries(headersArg as Record<string, string>)) {
        headers[key.toLowerCase()] = String(value);
      }
    }
    return originalWriteHead(code, ...args as [Record<string, string>]);
  } as typeof res.writeHead;

  // Capture writes with a custom writable
  const writable = new Writable({
    write(chunk: Buffer, _encoding: BufferEncoding, callback: () => void) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
    final(callback: () => void) {
      resolvePromise({
        status: statusCode,
        headers,
        body: Buffer.concat(chunks).toString("utf-8"),
      });
      callback();
    },
  });

  // Pipe response output to our writable
  res.assignSocket(writable as unknown as Socket);

  return {
    res,
    getResult: () => resultPromise,
  };
}

/**
 * Handle an MCP request using the SDK's StreamableHTTPServerTransport.
 */
async function handleMcpRequest(req: Request, userId: string): Promise<Response> {
  const body = await req.text();
  const parsedBody = JSON.parse(body);

  // Create a fresh server + transport for each request (stateless)
  const server = new McpServer({
    name: "SimplePost",
    version: "1.0.0",
  });
  registerTools(server, userId);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true,
  });

  await server.connect(transport);

  const incomingMessage = toIncomingMessage(req, body);
  const { res, getResult } = createCapturedResponse();

  await transport.handleRequest(incomingMessage, res, parsedBody);

  const result = await getResult();

  // Build the Web API Response
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(result.headers)) {
    responseHeaders.set(key, value);
  }

  return new Response(result.body, {
    status: result.status,
    headers: responseHeaders,
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

  try {
    return await handleMcpRequest(req, userId);
  } catch (error) {
    console.error("MCP request error:", error);
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32603, message: error instanceof Error ? error.message : "Internal error" },
        id: null,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * GET /mcp — SSE endpoint (not used in stateless mode).
 */
export async function GET(req: NextRequest) {
  const userId = await authenticateRequest(req);
  if (!userId) {
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
