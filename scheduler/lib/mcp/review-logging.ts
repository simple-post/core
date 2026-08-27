import { isTestUserEmail } from "@/lib/auth/test-users";
import { env } from "@/lib/env";
import { createLogger, redact } from "@/lib/logger";
import { sendTelegramReviewExchange } from "@/lib/logger/telegram";

const log = createLogger("mcp:review");

export interface ReviewMcpAuthContext {
  userEmail?: string | null;
  userId: string;
}

export interface ReviewMcpExchange {
  auth: ReviewMcpAuthContext;
  durationMs: number;
  requestBody: string;
  requestId: string;
  responseBody: string;
  status: number;
}

export function shouldLogReviewMcpExchange(auth: ReviewMcpAuthContext): auth is ReviewMcpAuthContext & {
  userEmail: string;
} {
  return env.ENABLE_OPENAI_TEST_LOGIN && isTestUserEmail(auth.userEmail);
}

/**
 * MCP receives JSON-RPC tool calls, not the reviewer's complete ChatGPT
 * conversation. Preserve the complete payload that crossed this server
 * boundary while recursively removing known credential fields.
 */
export function prepareReviewMcpPayload(body: string): { structured: unknown; text: string } {
  if (!body) {
    return { structured: null, text: "[empty body]" };
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    const structured = redact({ payload: parsed }).payload;
    return {
      structured,
      text: JSON.stringify(structured, null, 2),
    };
  } catch {
    // MCP traffic should always be JSON. Avoid copying an unexpected raw body
    // into logs because the normal key-based redaction cannot protect it.
    return {
      structured: "[unparseable non-JSON payload omitted]",
      text: "[unparseable non-JSON payload omitted]",
    };
  }
}

export async function logReviewMcpExchange(exchange: ReviewMcpExchange): Promise<void> {
  if (!shouldLogReviewMcpExchange(exchange.auth)) return;

  const request = prepareReviewMcpPayload(exchange.requestBody);
  const response = prepareReviewMcpPayload(exchange.responseBody);
  const timestamp = new Date().toISOString();

  log.info(
    {
      event: "review_mcp_exchange",
      requestId: exchange.requestId,
      userId: exchange.auth.userId,
      userEmail: exchange.auth.userEmail,
      status: exchange.status,
      durationMs: exchange.durationMs,
      mcpRequest: request.structured,
      mcpResponse: response.structured,
    },
    "Review/demo account MCP request and response",
  );

  await sendTelegramReviewExchange({
    requestId: exchange.requestId,
    timestamp,
    userId: exchange.auth.userId,
    userEmail: exchange.auth.userEmail,
    status: exchange.status,
    durationMs: exchange.durationMs,
    request: request.text,
    response: response.text,
  });
}
