type TelegramLogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface TelegramLogNotification {
  level: TelegramLogLevel;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
  error?: unknown;
}

const LEVEL_VALUES: Record<TelegramLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const DEFAULT_MAX_PER_MINUTE = 10;
const MAX_MESSAGE_LENGTH = 3900;

let windowStartedAt = 0;
let sentInWindow = 0;

function getTelegramConfig() {
  const botToken = process.env.LOG_TELEGRAM_BOT_TOKEN;
  const chatId = process.env.LOG_TELEGRAM_CHAT_ID;

  if (!botToken || !chatId || process.env.LOG_TELEGRAM_DISABLED === "true") {
    return null;
  }

  const configuredLevel = process.env.LOG_TELEGRAM_MIN_LEVEL as TelegramLogLevel | undefined;
  const minLevel = configuredLevel && configuredLevel in LEVEL_VALUES ? configuredLevel : "error";
  const maxPerMinute = Number.parseInt(process.env.LOG_TELEGRAM_MAX_PER_MINUTE || "", 10);

  return {
    botToken,
    chatId,
    minLevel,
    maxPerMinute: Number.isFinite(maxPerMinute) && maxPerMinute > 0 ? maxPerMinute : DEFAULT_MAX_PER_MINUTE,
  };
}

function shouldNotify(level: TelegramLogLevel, minLevel: TelegramLogLevel): boolean {
  return LEVEL_VALUES[level] >= LEVEL_VALUES[minLevel];
}

/**
 * Cheap check used by the logger hook to skip context extraction/redaction
 * work entirely when Telegram is not configured or the level is below the
 * configured threshold.
 */
export function isTelegramNotificationEnabled(level: TelegramLogLevel): boolean {
  const config = getTelegramConfig();
  return config !== null && shouldNotify(level, config.minLevel);
}

function consumeRateLimit(maxPerMinute: number): boolean {
  const now = Date.now();
  if (now - windowStartedAt > 60_000) {
    windowStartedAt = now;
    sentInWindow = 0;
  }

  if (sentInWindow >= maxPerMinute) {
    return false;
  }

  sentInWindow += 1;
  return true;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 14)}... [truncated]`;
}

function stringifyValue(value: unknown, maxLength = 900): string {
  if (value === undefined) return "";
  if (typeof value === "string") return truncate(value, maxLength);

  try {
    return truncate(JSON.stringify(value, null, 2), maxLength);
  } catch {
    return truncate(String(value), maxLength);
  }
}

function formatNotification(notification: TelegramLogNotification): string {
  const env = process.env.NODE_ENV || "development";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const context = notification.context || {};
  const moduleName = typeof context.module === "string" ? context.module : undefined;
  const requestId = typeof context.requestId === "string" ? context.requestId : undefined;
  const userId = typeof context.userId === "string" ? context.userId : undefined;

  const lines = [
    `<b>SimplePost Scheduler ${escapeHtml(notification.level.toUpperCase())}</b>`,
    `<b>Env:</b> ${escapeHtml(env)}`,
    `<b>Time:</b> ${escapeHtml(notification.timestamp)}`,
  ];

  if (appUrl) lines.push(`<b>App:</b> ${escapeHtml(appUrl)}`);
  if (moduleName) lines.push(`<b>Module:</b> ${escapeHtml(moduleName)}`);
  if (requestId) lines.push(`<b>Request:</b> ${escapeHtml(requestId)}`);
  if (userId) lines.push(`<b>User:</b> ${escapeHtml(userId)}`);

  lines.push(`<b>Message:</b> ${escapeHtml(truncate(notification.message, 600))}`);

  if (notification.error) {
    lines.push(`<b>Error:</b> <pre>${escapeHtml(stringifyValue(notification.error, 1200))}</pre>`);
  }

  const extraContext = { ...context };
  delete extraContext.module;
  delete extraContext.requestId;
  delete extraContext.userId;
  delete extraContext.err;
  delete extraContext.error;

  if (Object.keys(extraContext).length > 0) {
    lines.push(`<b>Context:</b> <pre>${escapeHtml(stringifyValue(extraContext, 1000))}</pre>`);
  }

  return truncate(lines.join("\n"), MAX_MESSAGE_LENGTH);
}

export async function sendTelegramLogNotification(notification: TelegramLogNotification): Promise<void> {
  const config = getTelegramConfig();
  if (!config || !shouldNotify(notification.level, config.minLevel)) {
    return;
  }

  if (!consumeRateLimit(config.maxPerMinute)) {
    console.warn("Telegram log notification skipped because LOG_TELEGRAM_MAX_PER_MINUTE was reached.");
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: formatNotification(notification),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

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
