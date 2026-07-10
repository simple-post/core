import { type NextRequest, NextResponse } from "next/server";

import { hashValue, revokeMcpToken } from "@/lib/mcp/oauth";
import { prisma } from "@/lib/prisma";

function parseBasicAuth(header: string | null): { clientId: string; clientSecret: string } | null {
  if (!header?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) return null;
    return { clientId: decoded.slice(0, separator), clientSecret: decoded.slice(separator + 1) };
  } catch {
    return null;
  }
}

async function requestParameters(req: NextRequest): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(await req.text()));
  }
  return (await req.json()) as Record<string, string>;
}

// RFC 7009 token revocation. Unknown/already-revoked tokens intentionally
// return 200 so the endpoint does not become a token-validity oracle.
export async function POST(req: NextRequest) {
  const params = await requestParameters(req);
  const token = params.token;
  if (!token) {
    return NextResponse.json({ error: "invalid_request", error_description: "token is required" }, { status: 400 });
  }

  const basic = parseBasicAuth(req.headers.get("authorization"));
  const clientId = params.client_id || basic?.clientId;
  const clientSecret = params.client_secret || basic?.clientSecret;

  if (clientId) {
    const client = await prisma.mcpOAuthClient.findUnique({ where: { clientId } });
    if (!client || (client.clientSecret && (!clientSecret || hashValue(clientSecret) !== client.clientSecret))) {
      return NextResponse.json(
        { error: "invalid_client", error_description: "OAuth client authentication failed" },
        { status: 401 },
      );
    }
  }

  await revokeMcpToken(token);
  return new NextResponse(null, { status: 200 });
}
