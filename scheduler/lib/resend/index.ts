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

export function sendEmail(to: string, subject: string, html: string) {
  return getResendClient().emails.send({
    from: env.RESEND_FROM_ADDRESS,
    to: to,
    subject: subject,
    html: html,
  });
}
