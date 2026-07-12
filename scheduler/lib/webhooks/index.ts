import crypto from "node:crypto";
import dns from "node:dns";
import net from "node:net";

import { Agent } from "undici";

import { createLogger, serializeError } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { AccountResultsMap } from "@/types";

const log = createLogger("webhooks");

export const WEBHOOK_EVENTS = ["post.published", "post.failed"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;

const webhookDispatcher = new Agent({
  connect: {
    // Resolve and validate the address used for every new connection. The
    // URL-string check alone is insufficient because a public hostname can
    // resolve to a private address.
    lookup: safeLookup,
  },
});

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

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && (b === 0 || b === 168)) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateAddress(address: string): boolean {
  const clean = address.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (net.isIPv4(clean)) {
    return isPrivateIPv4(clean.split(".").map(Number));
  }

  if (!net.isIPv6(clean)) return false;

  const mapped = /^::ffff:(.+)$/.exec(clean);
  if (mapped && net.isIPv4(mapped[1])) {
    return isPrivateIPv4(mapped[1].split(".").map(Number));
  }
  if (mapped) {
    const groups = mapped[1].split(":");
    if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) {
      const value = (Number.parseInt(groups[0], 16) << 16) | Number.parseInt(groups[1], 16);
      return isPrivateIPv4([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
    }
  }

  return (
    clean === "::" ||
    clean === "::1" ||
    /^fe[89ab][0-9a-f]:/.test(clean) ||
    /^f[cd][0-9a-f]{2}:/.test(clean) ||
    /^ff[0-9a-f]{2}:/.test(clean)
  );
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  return (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    /^metadata\./.test(normalized) ||
    /^internal\./.test(normalized) ||
    /\.internal$/.test(normalized)
  );
}

type LookupAddress = { address: string; family: number };
type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }

    const resolved = Array.isArray(addresses) ? addresses : [addresses];
    const blocked = resolved.find(({ address }) => isPrivateAddress(address));
    if (blocked) {
      callback(
        new Error(`Webhook hostname resolved to a private/internal address: ${hostname} -> ${blocked.address}`),
        "",
        0,
      );
      return;
    }

    const first = resolved[0];
    if (options.all) {
      callback(null, resolved);
    } else {
      callback(null, first.address, first.family);
    }
  });
}

/**
 * Validates a webhook target URL: http(s) only, no localhost/private/internal
 * hosts. Delivery performs the same check again and uses safeLookup on the
 * actual connection, including each manually-followed redirect.
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

  const hostname = parsed.hostname;
  const blocked = isBlockedHostname(hostname) || isPrivateAddress(hostname);

  if (blocked) {
    throw new Error("Webhook URLs must not point at localhost, private networks, or metadata endpoints");
  }
}

/** Validate a user-provided remote URL and its current DNS results before a direct fetch. */
export async function assertSafeRemoteUrl(url: string): Promise<void> {
  assertValidWebhookUrl(url);
  const hostname = new URL(url).hostname;
  const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  const blocked = addresses.find(({ address }) => isPrivateAddress(address));
  if (blocked) {
    throw new Error(`Remote hostname resolved to a private/internal address: ${hostname}`);
  }
}

async function fetchWebhook(url: string, init: RequestInit): Promise<Response> {
  let currentUrl = url;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    assertValidWebhookUrl(currentUrl);

    const response = await fetch(currentUrl, {
      ...init,
      redirect: "manual",
      // Node's built-in RequestInit does not expose dispatcher, but Next runs
      // this route in Node and passes it through to undici.
      dispatcher: webhookDispatcher,
    } as RequestInit & { dispatcher: Agent });

    if (![301, 302, 303, 307, 308].includes(response.status)) {
      return response;
    }

    const location = response.headers.get("location");
    if (!location) return response;

    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error(`Webhook endpoint redirected more than ${MAX_REDIRECTS} times`);
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

    const response = await fetchWebhook(endpoint.url, {
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
