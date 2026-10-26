import { renderEmailLayout } from "./email-layout";

export const OTP_EXPIRY_SECONDS = 10 * 60;

type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

const titles: Record<OtpPurpose, string> = {
  "sign-in": "Your sign-in code",
  "email-verification": "Verify your email",
  "forget-password": "Your password reset code",
  "change-email": "Confirm your new email",
};

/** Keep the code as one text node, with no spaces between digits, for email code detection. */
export function otpEmail(otp: string, purpose: OtpPurpose, appUrl: string) {
  if (!/^\d{6}$/.test(otp)) throw new Error("Expected a six-digit verification code");
  const title = titles[purpose];
  return {
    subject: `${otp} is your SimplePost verification code`,
    text: `Your SimplePost verification code is ${otp}.\n\n${title}. Enter this code in SimplePost to continue.\n\nThis code expires in 10 minutes and can only be used once.\nIf you didn't request this code, you can ignore this email. Never share your code.\n\nSimplePost`,
    html: renderEmailLayout({
      appUrl,
      title: `${title} · SimplePost`,
      preheader: `Your SimplePost verification code is ${otp}. It expires in 10 minutes.`,
      bodyHtml: `<h1 class="email-heading" style="margin:0 0 24px;font-size:28px;line-height:1.2;letter-spacing:-0.5px;color:#f5f5f5;">${title}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#b7b7b7;">Enter this verification code in SimplePost to continue:</p>
<p style="margin:0 0 24px;padding:20px 12px;border:1px solid #c6f432;border-radius:8px;background:#161616;text-align:center;font-family:monospace;font-size:36px;line-height:1.3;font-weight:bold;letter-spacing:6px;color:#c6f432;">${otp}</p>
<p style="margin:0 0 24px;font-size:14px;line-height:1.65;color:#b7b7b7;">This code expires in <strong>10 minutes</strong> and can only be used once.</p>
<p style="margin:0;padding-top:24px;border-top:1px solid #232323;font-size:12px;line-height:1.6;color:#858585;">If you didn't request this code, you can ignore this email. Never share your code.</p>`,
    }),
  };
}
