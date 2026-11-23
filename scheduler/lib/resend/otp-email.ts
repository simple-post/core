import type { Locale } from "../i18n/locales";
import { createTranslator, type MessageKey, type Messages } from "../i18n/translate";

import { escapeHtml, renderEmailLayout } from "./email-layout";

export const OTP_EXPIRY_SECONDS = 10 * 60;

type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

const titles: Record<OtpPurpose, MessageKey> = {
  "sign-in": "otpSignInTitle",
  "email-verification": "otpVerifyTitle",
  "forget-password": "otpResetTitle",
  "change-email": "otpChangeTitle",
};

/** Keep the code as one text node, with no spaces between digits, for email code detection. */
export function otpEmail(
  otp: string,
  purpose: OtpPurpose,
  appUrl: string,
  locale: Locale = "en",
  messages: Messages = {},
) {
  if (!/^\d{6}$/.test(otp)) throw new Error("Expected a six-digit verification code");
  const t = createTranslator(locale, messages);
  const title = t(titles[purpose]);
  const codeText = t("otpEmailCode", { code: otp });
  const instruction = t("otpEmailInstruction");
  const expiry = t("otpEmailExpiry", { minutes: OTP_EXPIRY_SECONDS / 60 });
  const unrequested = t("otpEmailUnrequested");
  return {
    subject: t("otpEmailSubject", { code: otp }),
    text: [codeText, title, instruction, expiry, unrequested, "SimplePost"].join("\n\n"),
    html: renderEmailLayout({
      appUrl,
      locale,
      title: `${title} · SimplePost`,
      preheader: `${codeText} ${expiry}`,
      bodyHtml: `<h1 class="email-heading" style="margin:0 0 24px;font-size:28px;line-height:1.2;letter-spacing:-0.5px;color:#f5f5f5;">${escapeHtml(title)}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#b7b7b7;">${escapeHtml(instruction)}</p>
<p dir="ltr" style="margin:0 0 24px;padding:20px 12px;border:1px solid #c6f432;border-radius:8px;background:#161616;text-align:center;font-family:monospace;font-size:36px;line-height:1.3;font-weight:bold;letter-spacing:6px;color:#c6f432;">${otp}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.65;color:#b7b7b7;">${escapeHtml(expiry)}</p>
<p style="margin:0;padding-top:24px;border-top:1px solid #232323;font-size:12px;line-height:1.6;color:#858585;">${escapeHtml(unrequested)}</p>`,
    }),
  };
}
