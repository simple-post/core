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

interface ReviewToolCallSummary {
  arguments: string;
  error?: string;
  succeeded: boolean;
  toolName: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function findToolCall(value: unknown): Record<string, unknown> | null {
  const messages = Array.isArray(value) ? value : [value];
  return messages.map((message) => asRecord(message)).find((message) => message?.method === "tools/call") ?? null;
}

function firstResponseError(response: Record<string, unknown> | null): string | undefined {
  const protocolError = asRecord(response?.error);
  if (typeof protocolError?.message === "string") return protocolError.message;

  const result = asRecord(response?.result);
  if (result?.isError !== true) return undefined;

  const content = Array.isArray(result.content) ? result.content : [];
  const textBlock = content
    .map((block) => asRecord(block))
    .find((block) => block?.type === "text" && typeof block.text === "string");
  return typeof textBlock?.text === "string" ? textBlock.text : "Tool returned an error";
}

export function prepareReviewToolCallSummary(
  request: unknown,
  response: unknown,
  status: number,
): ReviewToolCallSummary | null {
  const toolCall = findToolCall(request);
  if (!toolCall) return null;

  const params = asRecord(toolCall.params);
  const toolName = typeof params?.name === "string" ? params.name : "unknown";
  const toolArguments = params?.arguments ?? {};
  const responseMessage = Array.isArray(response) ? asRecord(response[0]) : asRecord(response);
  const error = firstResponseError(responseMessage);
  const succeeded = status >= 200 && status < 300 && !error;

  return {
    arguments: JSON.stringify(toolArguments),
    ...(error ? { error } : {}),
    succeeded,
    toolName,
  };
}

export async function logReviewMcpExchange(exchange: ReviewMcpExchange): Promise<void> {
  if (!shouldLogReviewMcpExchange(exchange.auth)) return;

  const request = prepareReviewMcpPayload(exchange.requestBody);
  const response = prepareReviewMcpPayload(exchange.responseBody);

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

  const toolCall = prepareReviewToolCallSummary(request.structured, response.structured, exchange.status);
  if (toolCall) {
    await sendTelegramReviewExchange({
      userEmail: exchange.auth.userEmail,
      toolName: toolCall.toolName,
      arguments: toolCall.arguments,
      succeeded: toolCall.succeeded,
      ...(toolCall.error ? { error: toolCall.error } : {}),
      status: exchange.status,
      durationMs: exchange.durationMs,
    });
  }
}
