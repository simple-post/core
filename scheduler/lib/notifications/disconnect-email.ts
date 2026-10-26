import { renderEmailLayout } from "../resend/email-layout";

export interface DisconnectEmailInput {
  platformName: string;
  accountLabel?: string | null;
  affectedQueuedPosts: number;
  appUrl: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderDisconnectEmail(input: DisconnectEmailInput): { subject: string; html: string; text: string } {
  // eslint-disable-next-line no-control-regex -- Strip control characters from profile labels and email headers.
  const platform = input.platformName.replaceAll(/[\r\n\u0000-\u001F]/g, "").slice(0, 80);
  // eslint-disable-next-line no-control-regex -- Strip control characters from profile labels and email headers.
  const label = input.accountLabel?.replaceAll(/[\r\n\u0000-\u001F]/g, "").slice(0, 120);
  const url = new URL("/accounts", input.appUrl);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid email application URL");
  const accountsUrl = url.toString();
  const count = Math.max(0, Math.floor(input.affectedQueuedPosts));
  const introduction = `Your ${platform} account${label ? ` ${label}` : ""} needs reconnecting in SimplePost.`;
  const impact =
    count > 0
      ? `${count} queued ${count === 1 ? "post needs" : "posts need"} this connection. Reconnect before your next scheduled post.`
      : "Reconnect before publishing to this account again.";
  const explanation =
    "The connection is no longer authorized, so SimplePost cannot publish to this account until you reconnect it.";
  const instruction = `Open Accounts in SimplePost, click Reconnect next to your ${platform} account, and complete the login.`;
  const failedPosts =
    "Upcoming queued posts keep their schedule. Any failed posts must be rescheduled separately; reconnecting won't publish them automatically.";
  const subject = `Reconnect your ${platform} account in SimplePost`;
  const html = renderEmailLayout({
    appUrl: input.appUrl,
    title: subject,
    preheader: introduction,
    bodyHtml: `<h1 class="email-heading" style="margin:0 0 24px;font-size:28px;line-height:1.2;letter-spacing:-0.5px;color:#f5f5f5">Reconnect your ${escapeHtml(platform)} account</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.65">Hi,</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.65">${escapeHtml(introduction)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#b7b7b7">${escapeHtml(explanation)}</p>
<p style="margin:0 0 24px;padding:16px;background:#161616;border-left:3px solid #c6f432;font-size:14px;line-height:1.6;color:#f5f5f5">${escapeHtml(impact)}</p>
<table role="presentation" style="border-collapse:collapse;margin:0 0 24px"><tr><td bgcolor="#c6f432" style="border-radius:6px"><a href="${escapeHtml(accountsUrl)}" style="display:inline-block;padding:14px 24px;background:#c6f432;border:1px solid #c6f432;border-radius:6px;color:#0a0a0a;text-decoration:none;font-size:15px;line-height:20px;font-weight:700">Reconnect account</a></td></tr></table>
<p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#b7b7b7">${escapeHtml(instruction)}</p>
<p style="margin:0 0 28px;font-size:14px;line-height:1.65;color:#b7b7b7">${escapeHtml(failedPosts)}</p>
<p style="margin:0;font-size:15px;line-height:1.65">Thanks,<br>Vlad</p>`,
    footerText: "You're receiving this account notification because you connected this account to SimplePost.",
  });
  return {
    subject,
    html,
    text: [
      "Hi,",
      introduction,
      explanation,
      impact,
      `Reconnect account: ${accountsUrl}`,
      instruction,
      failedPosts,
      "Thanks,\nVlad",
    ].join("\n\n"),
  };
}
