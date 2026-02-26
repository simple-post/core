import { Resend } from "resend";

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (resend) {
    return resend;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  resend = new Resend(apiKey);
  return resend;
}

export function sendEmail(to: string, subject: string, html: string) {
  return getResendClient().emails.send({
    from: process.env.RESEND_FROM_ADDRESS || "auth@simplepost.dev",
    to: to,
    subject: subject,
    html: html,
  });
}
