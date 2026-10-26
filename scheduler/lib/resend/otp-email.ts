export const OTP_EXPIRY_SECONDS = 10 * 60;

type OtpPurpose = "sign-in" | "email-verification" | "forget-password" | "change-email";

const titles: Record<OtpPurpose, string> = {
  "sign-in": "Your sign-in code",
  "email-verification": "Verify your email",
  "forget-password": "Your password reset code",
  "change-email": "Confirm your new email",
};

/** Keep the code as one text node, with no spaces between digits, for email code detection. */
export function otpEmail(otp: string, purpose: OtpPurpose) {
  if (!/^\d{6}$/.test(otp)) throw new Error("Expected a six-digit verification code");
  const title = titles[purpose];
  return {
    subject: `${otp} is your SimplePost verification code`,
    text: `Your SimplePost verification code is ${otp}.\n\n${title}. Enter this code in SimplePost to continue.\n\nThis code expires in 10 minutes and can only be used once.\nIf you didn't request this code, you can ignore this email. Never share your code.\n\nSimplePost`,
    html: `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title} · SimplePost</title></head>
  <body style="margin:0;padding:0;background-color:#0a0a0a;font-family:Arial,Helvetica,sans-serif;color:#f5f5f5;">
    <div style="display:none;max-height:0;overflow:hidden;">Your SimplePost verification code is ${otp}. It expires in 10 minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0a0a0a;">
      <tr><td align="center" style="padding:40px 16px;">
        <table role="presentation" width="440" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px;background-color:#111111;border:1px solid #232323;border-radius:12px;">
          <tr><td style="padding:32px;">
            <p style="margin:0 0 32px;font-family:monospace;font-size:16px;font-weight:bold;color:#c6f432;">SimplePost</p>
            <h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;font-weight:600;color:#f5f5f5;">${title}</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#bbbbbb;">Enter this verification code in SimplePost to continue:</p>
            <p style="margin:0 0 24px;padding:20px 12px;border:1px solid #c6f432;border-radius:8px;background-color:#161616;text-align:center;font-family:monospace;font-size:36px;line-height:1.3;font-weight:bold;letter-spacing:6px;color:#c6f432;">${otp}</p>
            <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#bbbbbb;">This code expires in <strong>10 minutes</strong> and can only be used once.</p>
            <p style="margin:0;padding-top:24px;border-top:1px solid #232323;font-size:12px;line-height:1.6;color:#999999;">If you didn't request this code, you can ignore this email. Never share your code.</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`,
  };
}
