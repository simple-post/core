import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY || "");

export function sendEmail(to: string, subject: string, html: string) {
  return resend.emails.send({
    from: process.env.RESEND_FROM_ADDRESS || "auth@simplepost.dev",
    to: to,
    subject: subject,
    html: html,
  });
}
