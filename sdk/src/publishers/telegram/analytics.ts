import { AnalyticsError } from "../../utils/analytics";
import { httpStatus } from "../../utils/transient-retry";

import type { AccountAnalytics } from "../../analytics";
import type { AxiosInstance } from "axios";

/**
 * Bots cannot read message views or reactions through the Bot API, so only
 * the chat's member (subscriber) count is available.
 */
export async function fetchTelegramAccountAnalytics(
  client: AxiosInstance,
  chatId: string,
  redact: (text: string) => string,
): Promise<AccountAnalytics> {
  try {
    const response = await client.get<{ ok?: boolean; result?: number }>("/getChatMemberCount", {
      params: { chat_id: chatId },
      timeout: 15_000,
    });
    const followers = response.data?.result;
    return {
      platform: "telegram",
      status: "ok",
      metrics: typeof followers === "number" ? { followers } : {},
      platformMetrics: typeof followers === "number" ? { member_count: followers } : undefined,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Never surface the raw error: Telegram request URLs contain the bot token.
    const status = httpStatus(error);
    const description = (error as { response?: { data?: { description?: unknown } } })?.response?.data?.description;
    const detail = typeof description === "string" ? `: ${redact(description)}` : ".";
    if (status === 401 || status === 404) {
      throw new AnalyticsError("credentials_error", `Telegram rejected the bot token${detail}`);
    }
    if (status === 400 || status === 403) {
      throw new AnalyticsError("missing_permission", `Telegram did not allow reading this chat${detail}`);
    }
    if (status === 429) throw new AnalyticsError("rate_limited", `Telegram rate limit reached${detail}`);
    throw new AnalyticsError("error", `Telegram request failed${detail}`);
  }
}
