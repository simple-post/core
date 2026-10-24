import { PostError, PostErrorType } from "../../types";

/** Keep provider diagnostics, never Axios config, headers, tokens, or signed URLs. */
export function uploadInitError(body: unknown, status?: number): PostError {
  const error = (body as { error?: { code?: unknown; log_id?: unknown; logid?: unknown } } | undefined)?.error;
  const code = typeof error?.code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(error.code) ? error.code : undefined;
  const rawLogId = error?.log_id ?? error?.logid;
  const logId = typeof rawLogId === "string" && /^[\w-]{1,128}$/.test(rawLogId) ? rawLogId : undefined;
  let message: string;
  switch (code) {
    case "spam_risk_too_many_pending_share": {
      message =
        "TikTok's pending-upload limit was reached (up to 5 pending shares within 24 hours). Open TikTok's inbox and finish publishing waiting uploads, then try again later. TikTok does not provide an exact reset time.";
      break;
    }
    case "rate_limit_exceeded": {
      message =
        "TikTok's upload request limit was reached (6 requests per minute for this account). Wait at least one minute before retrying.";
      break;
    }
    case "spam_risk_too_many_posts": {
      message =
        "TikTok's posting limit for this account was reached for the last 24 hours. Try again later or publish in the TikTok app.";
      break;
    }
    case "reached_active_user_cap": {
      message = "TikTok's daily active-creator limit for this app was reached. Try again later.";
      break;
    }
    case "spam_risk_user_banned_from_posting": {
      message =
        "TikTok has blocked this account from posting. Check the account's status in TikTok before trying again.";
      break;
    }
    case "access_token_invalid": {
      message = "TikTok's access token is invalid or expired. Reconnect the TikTok account before retrying.";
      break;
    }
    case "scope_not_authorized": {
      message =
        "TikTok has not granted the permission needed for this upload. Reconnect the account and grant the requested permissions.";
      break;
    }
    case "unaudited_client_can_only_post_to_private_accounts": {
      message =
        "TikTok unaudited apps can only post to private accounts. Set the TikTok account to private or get the app audited.";
      break;
    }
    case "url_ownership_unverified": {
      message =
        "TikTok could not verify the media URL's ownership. Use a domain or URL prefix verified in the TikTok developer app.";
      break;
    }
    case "privacy_level_option_mismatch": {
      message =
        "TikTok rejected the selected privacy setting. Choose a privacy option currently allowed for this account.";
      break;
    }
    default: {
      message = "TikTok upload initialization failed. Check the media and account settings before retrying.";
    }
  }
  // An explicit error envelope (including HTTP 200) is a rejection. Timeouts,
  // missing error codes, and server errors must retain the uncertain outcome.
  const rejected =
    code &&
    code !== "ok" &&
    status !== undefined &&
    (status === 200 || (status >= 400 && status < 500 && status !== 408));
  if (!rejected) {
    message =
      "TikTok did not confirm upload initialization. Check TikTok before retrying; the upload may have been accepted.";
  }
  return new PostError(
    rejected ? PostErrorType.PUBLISH_REJECTED : PostErrorType.API_ERROR,
    code && code !== "ok" ? `${message} (TikTok code: ${code})` : message,
    { phase: "init", httpStatus: status, code, logId },
  );
}
