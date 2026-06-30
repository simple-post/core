import crypto from "node:crypto";

import { createLogger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { AccountResultsMap } from "@/types";

const log = createLogger("webhooks");

export const WEBHOOK_EVENTS = ["post.published", "post.failed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const DELIVERY_TIMEOUT_MS = 10_000;

export interface PostWebhookPayload {
  id: string;
  status: "published" | "failed";
  message: string;
  scheduledFor?: string | null;
  publishedAt?: string | null;
  errorMessage?: string | null;
  accountResults?: AccountResultsMap | null;
}

export function signWebhookBody(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/**
 * Validates a webhook target URL: http(s) only, no localhost/private/internal
 * hosts (webhook URLs are server-side fetch targets controlled by users).
 * Note: this is a string-level check; names resolving to private addresses
 * are an accepted residual risk for self-hosted deployments.
 */
export function assertValidWebhookUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook URL: ${url}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Webhook URLs must use http or https");
  }

  const hostname = parsed.hostname.toLowerCase();
  const blocked =
    hostname === "localhost" ||
    hostname === "0.0.0.0" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^metadata\./.test(hostname) ||
    /\.internal$/.test(hostname);

  if (blocked) {
    throw new Error("Webhook URLs must not point at localhost, private networks, or metadata endpoints");
  }
}

async function deliver(
  endpoint: { id: string; url: string; secret: string },
  event: WebhookEvent,
  body: string,
): Promise<void> {
  const timestamp = String(Date.now());
  const signature = signWebhookBody(endpoint.secret, timestamp, body);

  try {
    assertValidWebhookUrl(endpoint.url);

    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "SimplePost-Webhooks/1.0",
        "X-SimplePost-Event": event,
        "X-SimplePost-Timestamp": timestamp,
        "X-SimplePost-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Endpoint responded with HTTP ${response.status}`);
    }

    await prisma.webhookEndpoint.update({
      where: { id: endpoint.id },
      data: { lastSuccessAt: new Date(), lastError: null },
    });
    log.info({ endpointId: endpoint.id, event }, "Webhook delivered");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown delivery error";
    log.warn({ endpointId: endpoint.id, event, err: serializeError(error) }, "Webhook delivery failed");
    await prisma.webhookEndpoint
      .update({
        where: { id: endpoint.id },
        data: { lastFailureAt: new Date(), lastError: message.slice(0, 500) },
      })
      .catch(() => {});
  }
}

/**
 * Delivers a post lifecycle event to every active endpoint the user has
 * subscribed to it. Never throws — webhook delivery must not affect the
 * publishing flow that triggered it.
 */
export async function dispatchPostWebhooks(
  userId: string,
  event: WebhookEvent,
  post: PostWebhookPayload,
): Promise<void> {
  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { userId, active: true, events: { has: event } },
      select: { id: true, url: true, secret: true },
    });

    if (endpoints.length === 0) return;

    const body = JSON.stringify({ event, createdAt: new Date().toISOString(), post });
    await Promise.all(endpoints.map((endpoint) => deliver(endpoint, event, body)));
  } catch (error) {
    log.error({ userId, event, err: serializeError(error) }, "Webhook dispatch failed");
  }
}
