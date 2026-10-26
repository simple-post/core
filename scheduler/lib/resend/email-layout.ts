interface EmailLayoutInput {
  appUrl: string;
  title: string;
  preheader: string;
  bodyHtml: string;
  footerText?: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Shared branding for transactional emails. bodyHtml must already be escaped. */
export function renderEmailLayout(input: EmailLayoutInput): string {
  const logoUrl = new URL("/simplepost-logo.png", input.appUrl);
  if (!["https:", "http:"].includes(logoUrl.protocol)) throw new Error("Invalid email application URL");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title><style>@media only screen and (max-width:480px){.email-content{padding:24px!important}.email-heading{font-size:26px!important}}</style></head><body style="margin:0;padding:0;background:#0a0a0a;color:#f5f5f5;font-family:Inter,Arial,Helvetica,sans-serif">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(input.preheader)}</div>
<table role="presentation" width="100%" bgcolor="#0a0a0a" style="width:100%;border-collapse:collapse"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" bgcolor="#111111" style="width:100%;max-width:560px;border-collapse:separate;border-spacing:0;background:#111111;border:1px solid #232323;border-radius:12px"><tr><td class="email-content" style="padding:32px;color:#f5f5f5;word-break:break-word">
<table role="presentation" style="border-collapse:collapse;margin:0 0 28px"><tr><td width="64" style="width:64px;padding:0 12px 0 0"><img src="${escapeHtml(logoUrl.toString())}" alt="SP" width="64" height="64" style="display:block;width:64px;height:64px;border:0"></td><td style="font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-0.7px;color:#f5f5f5">SimplePost</td></tr></table>
${input.bodyHtml}
</td></tr></table>${
    input.footerText
      ? `
<p style="max-width:520px;margin:20px 0 0;font-size:12px;line-height:1.6;color:#858585">${escapeHtml(input.footerText)}</p>`
      : ""
  }
</td></tr></table></body></html>`;
}
