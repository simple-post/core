import { env } from "@/lib/env";

export interface NotificationEmail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailDeliveryError extends Error {
  constructor(readonly status: number) {
    // Never log provider response bodies, recipients, request headers, or API keys.
    super(`Email provider returned status ${status}`);
  }
}

/** Bounded delivery with a stable request body and Resend's idempotency key. */
export async function sendNotificationEmail(message: NotificationEmail, idempotencyKey: string): Promise<string> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    // PostgreSQL JSONB reorders keys. Keep the request bytes stable on every retry too.
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  if (!response.ok) throw new EmailDeliveryError(response.status);
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("id" in data) ||
    typeof data.id !== "string" ||
    !/^[\w-]{1,200}$/.test(data.id)
  )
    throw new Error("Email provider did not return a message ID");
  return data.id;
}
