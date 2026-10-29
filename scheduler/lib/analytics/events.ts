import { createHash, randomUUID } from "node:crypto";

import { env } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export const FUNNEL_KINDS = [
  "authentication_failed",
  "authentication_completed",
  "signup_code_sent",
  "signup_code_failed",
  "social_connection_started",
  "social_connection_failed",
  "social_connection_cancelled",
  "assistant_authorization_started",
  "assistant_authorization_failed",
  "assistant_authorization_cancelled",
  "tool_called",
  "tool_succeeded",
  "tool_failed",
  "post_create_attempted",
  "post_create_rejected",
  "plan_viewed",
  "checkout_created",
  "checkout_failed",
  "checkout_completed",
  "checkout_expired",
  "invoice_paid",
  "invoice_payment_failed",
  "subscription_cancel_requested",
  "subscription_ended",
  "billing_denied",
] as const;
export type FunnelKind = (typeof FUNNEL_KINDS)[number];
type Scalar = string | number | boolean;
const log = createLogger("analytics:funnel");
const KEYS = new Set([
  "method",
  "platform",
  "tool",
  "client",
  "reason",
  "plan",
  "status",
  "entrypoint",
  "durationMs",
  "amountPaid",
  "currency",
  "billingReason",
  "attempt",
  "source",
  "signupVersion",
  "onboardingVersion",
  "measurementVersion",
]);

/** Reject free-form errors, content, identifiers, credentials and arbitrary URL/query fields. */
export function funnelProperties(values: Record<string, unknown> = {}): Record<string, Scalar> {
  const result: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!KEYS.has(key)) continue;
    if (typeof value === "boolean") result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value))
      result[key] = Math.max(0, Math.min(value, 1_000_000_000));
    else if (typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value)) result[key] = value;
  }
  return result;
}

/** Operational measurement is internal and best effort. Nothing is sent to an external service. */
export async function recordFunnelEvent(
  userId: string | null,
  kind: FunnelKind,
  options: {
    key?: string;
    channel?: "web" | "mcp" | "billing" | "auth" | "api";
    at?: Date;
    properties?: Record<string, unknown>;
  } = {},
): Promise<void> {
  if (env.SELF_HOSTED) return;
  try {
    const id = createHash("md5")
      .update(`funnel:${kind}:${options.key ?? randomUUID()}`)
      .digest("hex");
    const properties = JSON.stringify(funnelProperties({ measurementVersion: "funnel-v2", ...options.properties }));
    await prisma.$executeRaw`
      INSERT INTO "funnel_event" ("id", "userId", "kind", "channel", "occurredAt", "properties")
      SELECT ${id}, ${userId}::text, ${kind}, ${options.channel ?? "web"}, ${(options.at ?? new Date()).toISOString()}::timestamp, ${properties}::jsonb
      WHERE ${userId}::text IS NULL OR EXISTS (
        SELECT 1 FROM "user" WHERE id=${userId}::text AND NOT "isAdmin" AND NOT "analyticsExcluded"
      )
      ON CONFLICT (id) DO NOTHING
    `;
  } catch {
    log.warn({ errorCode: "funnel_capture_failed", kind }, "Optional funnel measurement failed");
  }
}

export function measurementFailure(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && /^[a-zA-Z_0-9]{1,60}$/.test(code) ? code : "unknown_error";
}
