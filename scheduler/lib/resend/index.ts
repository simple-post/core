import { Resend } from "resend";

import { env } from "../env";

let resend: Resend | null = null;

function getResendClient(): Resend {
  if (resend) {
    return resend;
  }

  resend = new Resend(env.RESEND_API_KEY);
  return resend;
}

export async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const result = await getResendClient().emails.send({
    from: env.RESEND_FROM_ADDRESS,
    to: to,
    subject: subject,
    html: html,
    text,
  });
  // Resend reports delivery failures as data; do not tell the user a code was sent.
  if (result.error) throw new Error("Failed to send sign-in email");
  return result;
}
