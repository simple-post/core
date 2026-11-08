import { context as otelContext } from "@opentelemetry/api";
import { suppressTracing } from "@opentelemetry/core";

export interface TelegramReviewExchangeNotification {
  userEmail: string;
  toolName: string;
  arguments: string;
  durationMs: number;
  error?: string;
  status: number;
  succeeded: boolean;
}

// Application error reports are sent by lib/error-reporting.ts. This file
// retains the separate, intentionally rate-limited demo review notifications.
const MAX_MESSAGE_LENGTH = 3900;
const MAX_REVIEW_ARGUMENTS_LENGTH = 1500;
const MAX_REVIEW_ERROR_LENGTH = 600;
let reviewWindowStartedAt = 0;
let reviewExchangesInWindow = 0;
function getTelegramConfig() {
  const botToken = process.env.LOG_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.LOG_TELEGRAM_CHAT_ID;
  if (!botToken || !chatId || process.env.LOG_TELEGRAM_DISABLED === "true") return null;
  const cap = Number(process.env.LOG_TELEGRAM_REVIEW_MAX_PER_MINUTE);
  return { botToken, chatId, reviewMaxPerMinute: Number.isFinite(cap) && cap > 0 ? cap : 60 };
}
function consumeReviewRateLimit(maxPerMinute: number): boolean {
  const now = Date.now();
  if (now - reviewWindowStartedAt > 60_000) {
    reviewWindowStartedAt = now;
    reviewExchangesInWindow = 0;
  }
  if (reviewExchangesInWindow >= maxPerMinute) return false;
  reviewExchangesInWindow += 1;
  return true;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 14)}... [truncated]`;
}

export function formatTelegramReviewExchange(notification: TelegramReviewExchangeNotification): string {
  const lines = [
    "SimplePost demo tool call",
    `Account: ${notification.userEmail}`,
    `Tool: ${notification.toolName}`,
    `Args: ${truncate(notification.arguments, MAX_REVIEW_ARGUMENTS_LENGTH)}`,
    `Result: ${notification.succeeded ? "Success" : "Failed"}`,
  ];
  if (notification.error) {
    lines.push(`Error: ${truncate(notification.error, MAX_REVIEW_ERROR_LENGTH)}`);
  }
  lines.push(`HTTP: ${notification.status} · ${notification.durationMs} ms`);

  return truncate(lines.join("\n"), MAX_MESSAGE_LENGTH);
}

async function postTelegramMessage(
  config: NonNullable<ReturnType<typeof getTelegramConfig>>,
  text: string,
  parseMode?: "HTML",
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    // Telegram requires the bot token in the request path. Suppress tracing
    // so auto-instrumentation cannot export that secret as a URL attribute.
    const response = await otelContext.with(suppressTracing(otelContext.active()), () =>
      fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          ...(parseMode ? { parse_mode: parseMode } : {}),
          disable_web_page_preview: true,
        }),
        signal: controller.signal,
      }),
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.error(
        `Telegram log notification failed with ${response.status}: ${truncate(body || response.statusText, 500)}`,
      );
    }
  } catch (error) {
    console.error("Telegram log notification failed:", error);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send a review-account MCP exchange on the dedicated review channel. Review events have a rate limit because a submission test can
 * make several successful tool calls in quick succession.
 */
export async function sendTelegramReviewExchange(notification: TelegramReviewExchangeNotification): Promise<void> {
  const config = getTelegramConfig();
  if (!config) return;

  if (!consumeReviewRateLimit(config.reviewMaxPerMinute)) {
    console.warn("Telegram review notification skipped because LOG_TELEGRAM_REVIEW_MAX_PER_MINUTE was reached.");
    return;
  }

  await postTelegramMessage(config, formatTelegramReviewExchange(notification));
}
