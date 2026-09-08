import axios from "axios";

import { getXTextLength } from "../publishers/x/validation";
import { PostError, PostErrorType } from "../types";

import type { Content, Platform, PostOptions } from "../types/post";
import type { ValidationIssue } from "../types/validation";

export function readinessFailure(platform: Platform, error: unknown): ValidationIssue {
  const response = (error as { response?: { status?: number; data?: { error?: { code?: number } } } })?.response;
  const known =
    error instanceof PostError &&
    [PostErrorType.INVALID_CONTENT, PostErrorType.CREDENTIALS_ERROR].includes(error.errorType);
  const unauthorized = response?.status === 401 || response?.data?.error?.code === 190;
  let code = "account_readiness_unverified";
  let severity: "error" | "warning" = "warning";
  let message = `${platform}: current account permissions and limits could not be verified. The provider may still reject this post; check the account connection and retry validation.`;
  if (known) {
    code = "account_ineligible";
    severity = "error";
    message = error.message;
  } else if (unauthorized) {
    code = "account_unauthorized";
    severity = "error";
    message = `${platform}: the connection is no longer authorized. Reconnect the account.`;
  } else if (response?.status === 429) {
    code = "account_rate_limited";
    severity = "error";
    message = `${platform}: account checks are rate limited. Wait before retrying.`;
  }
  return { platform, severity, code, field: "account", message };
}

/** Only read endpoints. Never infer posting permission from a failed optional read scope. */
export async function checkAccountReadiness(
  platform: Platform,
  content: Content,
  options?: PostOptions,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = [];
  const warning = (message: string) =>
    issues.push({ platform, severity: "warning", code: "account_readiness_unverified", field: "account", message });
  const block = (message: string, code = "account_ineligible", actual?: number, limit?: number) =>
    issues.push({ platform, severity: "error", code, field: "account", message, actual, limit });
  const get = async <T>(url: string, token: string, params?: Record<string, string>) => {
    const response = await axios.get<T>(url, {
      headers: { Authorization: `Bearer ${token}` },
      params,
      timeout: 10_000,
      maxRedirects: 0,
    });
    return response.data;
  };
  switch (platform) {
    case "instagram":
    case "threads": {
      const credentials = platform === "instagram" ? options?.instagram?.credentials : options?.threads?.credentials;
      if (!credentials)
        throw new PostError(PostErrorType.CREDENTIALS_ERROR, `Connect your ${platform} account before publishing.`);
      const instagram = options?.instagram?.credentials;
      let base = "https://graph.instagram.com/v25.0";
      if (platform === "threads") base = "https://graph.threads.net/v1.0";
      else if (instagram?.graphApi === "facebook") base = "https://graph.facebook.com/v25.0";
      const id = platform === "instagram" ? instagram!.businessAccountId : options!.threads!.credentials!.userId;
      const quota = await get<{ data?: Array<{ quota_usage?: number; config?: { quota_total?: number } }> }>(
        `${base}/${encodeURIComponent(id)}/${platform === "instagram" ? "content_publishing_limit" : "threads_publishing_limit"}`,
        credentials.accessToken,
        { fields: "quota_usage,config" },
      );
      const usage = quota.data?.[0];
      if (typeof usage?.quota_usage === "number" && typeof usage.config?.quota_total === "number") {
        if (usage.quota_usage >= usage.config.quota_total)
          block(
            `${platform}: the account has used its current publishing quota. Wait for the rolling limit to reset.`,
            "publishing_quota_exhausted",
            usage.quota_usage,
            usage.config.quota_total,
          );
      } else
        warning(
          `${platform}: the provider did not return a usable publishing quota. Remaining capacity is unverified.`,
        );
      if (platform === "threads" && options?.threads?.replyToId) {
        try {
          await get(`${base}/${encodeURIComponent(options.threads.replyToId)}`, credentials.accessToken, {
            fields: "id",
          });
        } catch (error) {
          if ((error as { response?: { status?: number } }).response?.status === 404)
            block("The Threads reply target is unavailable. Choose an accessible post.", "reply_target_unavailable");
          else throw error;
        }
      }

      break;
    }
    case "pinterest": {
      const settings = options?.pinterest;
      if (!settings?.boardId) block("Select a Pinterest board before publishing.", "pinterest_board_required");
      else if (settings.credentials) {
        try {
          await get(
            `https://api.pinterest.com/v5/boards/${encodeURIComponent(settings.boardId)}`,
            settings.credentials.accessToken,
          );
          warning(
            "The Pinterest board is accessible, but collaborator write permission is not exposed by this check. Confirm that this account can create Pins on it.",
          );
        } catch (error) {
          if ((error as { response?: { status?: number } }).response?.status === 404)
            block("The Pinterest board does not exist or is inaccessible. Select another board.", "board_unavailable");
          else throw error;
        }
      }

      break;
    }
    case "telegram": {
      const settings = options?.telegram;
      if (!settings?.chatId || !settings.credentials)
        throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Connect the Telegram bot and choose a destination chat.");
      // Telegram authenticates in the URL. These URLs and response objects must never enter diagnostics.
      const read = async <T>(method: string, params?: Record<string, string>) => {
        const response = await axios.get<{ ok: boolean; result: T }>(
          `https://api.telegram.org/bot${settings.credentials!.botToken}/${method}`,
          { params, timeout: 10_000, maxRedirects: 0 },
        );
        const body = response.data;
        if (!body.ok) throw new Error("Telegram account check unavailable");
        return body.result;
      };
      const bot = await read<{ id: number }>("getMe");
      const chat = await read<{
        type: string;
        permissions?: { can_send_messages?: boolean; can_send_photos?: boolean; can_send_videos?: boolean };
      }>("getChat", { chat_id: settings.chatId });
      if (chat.type !== "private") {
        const member = await read<{
          status: string;
          can_post_messages?: boolean;
          can_send_messages?: boolean;
          can_send_photos?: boolean;
          can_send_videos?: boolean;
        }>("getChatMember", { chat_id: settings.chatId, user_id: String(bot.id) });
        const privileged = ["creator", "administrator"].includes(member.status);
        if (
          ["left", "kicked"].includes(member.status) ||
          (chat.type === "channel" && member.status !== "creator" && member.can_post_messages !== true)
        )
          block("The Telegram bot cannot post to this chat. Add it as an administrator with permission to post.");
        let rights = privileged ? undefined : chat.permissions;
        if (member.status === "restricted") rights = member;
        if (
          rights?.can_send_messages === false ||
          (content.media?.some((item) => item.type === "image") && rights?.can_send_photos === false) ||
          (content.media?.some((item) => item.type === "video") && rights?.can_send_videos === false)
        )
          block("The Telegram bot lacks permission to send this content type in the destination chat.");
      }

      break;
    }
    case "x": {
      const duration = Math.max(
        0,
        ...(content.media ?? []).map((item) => (item.type === "video" ? (item.durationSec ?? 0) : 0)),
      );
      if (getXTextLength(content.text ?? "") > 280 || duration > 1200) {
        const token = options?.x?.credentials?.accessToken;
        if (token) {
          const account = await get<{ data?: { subscription_type?: string } }>("https://api.x.com/2/users/me", token, {
            "user.fields": "subscription_type",
          });
          const subscription = account.data?.subscription_type?.toLowerCase();
          if (subscription === "none")
            block(
              "This X account does not have Premium. Use at most 280 weighted characters and a video no longer than 20 minutes.",
              "x_premium_required",
            );
          else if (!subscription)
            warning("X did not report this account's Premium status. Long content eligibility is unverified.");
        } else {
          warning("X Premium access could not be verified with these credentials.");
        }
      }

      break;
    }
    case "facebook": {
      const credentials = options?.facebook?.credentials;
      if (credentials) {
        const page = await get<{ id?: string; tasks?: string[] }>(
          `https://graph.facebook.com/v25.0/${encodeURIComponent(credentials.pageId)}`,
          credentials.pageAccessToken,
          { fields: "id,tasks" },
        );
        if (
          page.tasks &&
          !page.tasks.some((task) => ["CREATE_CONTENT", "MANAGE", "PROFILE_PLUS_CREATE_CONTENT"].includes(task))
        )
          block(
            "This Facebook Page connection does not have permission to create content. Reconnect with Page publishing access.",
          );
        else if (!page.tasks)
          warning("Facebook did not expose Page publishing tasks; publishing permission remains unverified.");
      }

      break;
    }
    case "linkedin": {
      warning(
        "LinkedIn does not expose a reliable pre-publish check for this member's posting restrictions. Media and content are checked; account restrictions remain provider-side.",
      );

      break;
    }
    // No default
  }
  return issues;
}
