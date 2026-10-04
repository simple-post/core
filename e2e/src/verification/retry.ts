import { expect } from "@playwright/test";
import type { SchedulerApi } from "../http.js";

/** HTTP failures retain structured status/header data; assertions remain retryable. */
export class VerificationHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter?: string,
    readonly source: "page" | "metadata" = "page",
  ) {
    super(`Platform ${source === "page" ? "page" : "metadata read"} returned ${status}`);
  }
}

export class VerificationDeadlineError extends Error {
  override name = "VerificationDeadlineError";
  constructor(cause?: unknown) {
    super(
      `Platform verification deadline exceeded; receipt retained, do not republish${cause instanceof Error ? `: ${cause.message}` : ""}`,
      { cause },
    );
  }
}

export function retryAfterMs(value: string | undefined, now: number): number | undefined {
  if (!value?.trim()) return;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000;
  if (/^[+-]?[\d.]+$/.test(text)) return;
  const date = Date.parse(text);
  if (Number.isFinite(date)) return Math.max(0, date - now);
}

export type RetryDecision = { retry: false } | { retry: true; delayMs: number; reload: boolean };
export function verificationRetry(input: {
  error: unknown;
  now: number;
  deadline: number;
  lastNavigation: number;
  pollsSinceNavigation: number;
  rateLimits: number;
}): RetryDecision {
  const { error, now, deadline } = input;
  const remaining = deadline - now;
  if (remaining <= 0 || error instanceof VerificationDeadlineError) return { retry: false };
  let delayMs = 1000;
  let reload = input.pollsSinceNavigation >= 1 && now - input.lastNavigation >= 10_000;
  if (error instanceof VerificationHttpError) {
    // 404 can mean a newly published post has not propagated yet.
    if (error.status !== 404 && error.status !== 429 && !(error.status >= 500 && error.status <= 599))
      return { retry: false };
    reload = error.source === "page";
    if (error.status === 429) {
      if (input.rateLimits >= 3) return { retry: false };
      delayMs = Math.max(1000, retryAfterMs(error.retryAfter, now) ?? 2000 * 2 ** input.rateLimits);
      // Never shorten the server's requested pause to squeeze in another request.
      if (delayMs > 30_000) return { retry: false };
    } else delayMs = 2000;
  }
  if (delayMs >= remaining) return { retry: false };
  return { retry: true, delayMs, reload };
}

/** Only explicit authentication/challenge routes, never a profile or missing post. */
export function isVerificationLoginUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      /^\/(?:accounts\/|auth\/|passport\/web\/|uas\/)?(?:login|log-in|signin|sign-in|checkpoint|challenge|captcha)(?:\/|$)/i.test(
        url.pathname,
      ) ||
      /^\/i\/flow\/login(?:\/|$)/i.test(url.pathname) ||
      (url.hostname === "accounts.google.com" && /\/ServiceLogin|\/v3\/signin/i.test(url.pathname))
    );
  } catch {
    return false;
  }
}

export class VerificationSetupError extends Error {
  override name = "VerificationSetupError";
}

export interface VerificationBudget {
  deadline: number;
  signal: AbortSignal;
  onFailure?: (error: unknown) => void;
  lastFailure?: unknown;
}

export function verificationTimeout(budget?: VerificationBudget, maximum = 5000): number {
  if (!budget) return maximum;
  budget.signal.throwIfAborted();
  const remaining = budget.deadline - Date.now();
  if (remaining <= 0) throw new VerificationDeadlineError(budget.lastFailure);
  return Math.max(1, Math.min(maximum, remaining));
}

/** Owns its timer and abort listener; work must use the supplied signal/timeouts. */
export async function withVerificationBudget<T>(
  parent: VerificationBudget | undefined,
  maximum: number,
  work: (budget: VerificationBudget) => Promise<T>,
): Promise<T> {
  verificationTimeout(parent, maximum);
  const controller = new AbortController();
  const deadline = Math.min(parent?.deadline ?? Infinity, Date.now() + maximum);
  const abort = () => controller.abort(parent!.signal.reason);
  parent?.signal.addEventListener("abort", abort, { once: true });
  if (parent?.signal.aborted) abort();
  const timer = setTimeout(
    () => controller.abort(new VerificationDeadlineError(parent?.lastFailure)),
    Math.max(1, deadline - Date.now()),
  );
  const budget = { deadline, signal: controller.signal, onFailure: parent?.onFailure };
  try {
    verificationTimeout(budget);
    const result = await work(budget);
    verificationTimeout(budget);
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    parent?.signal.removeEventListener("abort", abort);
  }
}

export async function verificationSleep(ms: number, budget?: VerificationBudget): Promise<void> {
  const duration = verificationTimeout(budget, ms);
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      budget?.signal.removeEventListener("abort", abort);
      reject(budget?.signal.reason);
    };
    const timer = setTimeout(() => {
      budget?.signal.removeEventListener("abort", abort);
      resolve();
    }, duration);
    budget?.signal.addEventListener("abort", abort, { once: true });
    if (budget?.signal.aborted) abort();
  });
  verificationTimeout(budget);
}

interface PollOptions {
  message?: string;
  timeout?: number;
  intervals?: number[];
}
/** Unlike expect.poll's callback race, this never abandons an in-flight callback. */
export function budgetPoll<T>(actual: () => T | Promise<T>, options: PollOptions = {}, budget?: VerificationBudget) {
  const run = async (assert: (value: T) => void) => {
    const deadline = Date.now() + verificationTimeout(budget, options.timeout ?? 5000);
    const intervals = options.intervals ?? [100, 250, 500, 1000];
    let attempt = 0;
    for (;;) {
      verificationTimeout(budget);
      const value = await actual();
      verificationTimeout(budget);
      try {
        assert(value);
        return;
      } catch (error) {
        if (budget) budget.lastFailure = error;
        budget?.onFailure?.(error);
        const delay = intervals[Math.min(attempt++, intervals.length - 1)] ?? 1000;
        if (Date.now() + delay >= deadline) throw error;
        await verificationSleep(delay, budget);
      }
    }
  };
  return {
    toBe: (expected: unknown) => run((value) => expect(value as unknown, options.message).toBe(expected)),
    toEqual: (expected: unknown) => run((value) => expect(value as unknown, options.message).toEqual(expected)),
    toContain: (expected: unknown) => run((value) => expect(value as unknown, options.message).toContain(expected)),
    toBeGreaterThan: (expected: number) =>
      run((value) => expect(value as unknown, options.message).toBeGreaterThan(expected)),
  };
}

export function assertVerificationResponse(
  status: number,
  retryAfter?: string,
  source: "page" | "metadata" = "metadata",
) {
  if (status < 400) return;
  if (status === 401 || status === 403)
    throw new VerificationSetupError(
      `Platform ${source} returned ${status}; observer access is denied. Receipt retained; do not republish.`,
    );
  throw new VerificationHttpError(status, retryAfter, source);
}

/** A single authenticated GET: retries belong to the cancellable verification policy. */
export async function verificationRead<T>(api: SchedulerApi, route: string, parent?: VerificationBudget): Promise<T> {
  if (!route.startsWith("/api/")) throw new Error("Only scheduler API routes are allowed");
  return withVerificationBudget(parent, api.config.readTimeoutMs, async (budget) => {
    const context = await api.context(); // Public fresh-context API: this function owns disposal.
    let closing: Promise<void> | undefined;
    const close = () => (closing ??= context.dispose());
    const abort = () => {
      void close().catch(() => {});
    };
    budget.signal.addEventListener("abort", abort, { once: true });
    try {
      verificationTimeout(budget);
      const response = await context.get(api.config.baseUrl + route, {
        timeout: verificationTimeout(budget, api.config.readTimeoutMs),
        maxRedirects: 0,
      });
      try {
        verificationTimeout(budget);
        assertVerificationResponse(response.status(), response.headers()["retry-after"]);
        return (await response.json()) as T;
      } finally {
        await response.dispose();
      }
    } finally {
      budget.signal.removeEventListener("abort", abort);
      await close();
    }
  });
}
