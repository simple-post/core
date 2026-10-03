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
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:0;background:#f5f5f7;color:#18181b;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(introduction)}</div>
<table role="presentation" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" style="width:100%;max-width:560px;border-collapse:collapse;background:#ffffff;border:1px solid #e4e4e7;border-radius:12px"><tr><td style="padding:32px">
<p style="margin:0 0 28px;font-size:18px;font-weight:700">SimplePost<span style="color:#7c3aed">.</span></p>
<h1 style="margin:0 0 24px;font-size:26px;line-height:1.2;letter-spacing:-0.5px">Reconnect your ${escapeHtml(platform)} account</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.65">Hi,</p>
<p style="margin:0 0 16px;font-size:15px;line-height:1.65">${escapeHtml(introduction)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#52525b">${escapeHtml(explanation)}</p>
<p style="margin:0 0 24px;padding:16px;background:#f5f3ff;border-left:3px solid #7c3aed;font-size:14px;line-height:1.6">${escapeHtml(impact)}</p>
<table role="presentation" style="border-collapse:collapse;margin:0 0 24px"><tr><td bgcolor="#7c3aed" style="border-radius:6px"><a href="${escapeHtml(accountsUrl)}" style="display:inline-block;padding:13px 22px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700">Reconnect account</a></td></tr></table>
<p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:#52525b">${escapeHtml(instruction)}</p>
<p style="margin:0 0 28px;font-size:14px;line-height:1.65;color:#52525b">${escapeHtml(failedPosts)}</p>
<p style="margin:0;font-size:15px;line-height:1.65">Thanks,<br>Vlad</p>
</td></tr></table>
<p style="max-width:520px;margin:20px 0 0;font-size:12px;line-height:1.6;color:#71717a">You're receiving this account notification because you connected this account to SimplePost.</p>
</td></tr></table></body></html>`;
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
