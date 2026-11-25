import { classifyAnalyticsError, toFiniteNumber } from "./analytics";

import type { AxiosInstance } from "axios";

/** Insight values are numbers or (for breakdowns such as reactions by type) objects of numbers. */
export type InsightValue = number | Record<string, number>;

interface InsightsResponse {
  data?: Array<{ name?: string; values?: Array<{ value?: unknown }>; total_value?: { value?: unknown } }>;
}

function metaErrorCode(error: unknown): number | undefined {
  const code = (error as { response?: { data?: { error?: { code?: unknown } } } })?.response?.data?.error?.code;
  return typeof code === "number" ? code : undefined;
}

/** Meta answers an unknown/unsupported metric with error code 100 (invalid parameter). */
/**
 * Meta also uses code 100 for "object does not exist" (subcode 33). Only treat
 * code 100 as an invalid metric when it is not about the object itself, so a
 * deleted post is not misread as a post without metrics.
 */
function isInvalidMetricError(error: unknown): boolean {
  if (metaErrorCode(error) !== 100) return false;
  const body = (error as { response?: { data?: { error?: { error_subcode?: unknown; message?: unknown } } } })?.response
    ?.data?.error;
  if (body?.error_subcode === 33) return false;
  return !(
    typeof body?.message === "string" && /does not exist|cannot be loaded|unsupported get request/i.test(body.message)
  );
}

function parseValue(value: unknown): InsightValue | undefined {
  const number = toFiniteNumber(value);
  if (number !== undefined) return number;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, toFiniteNumber(entry)] as const)
      .filter((entry): entry is readonly [string, number] => entry[1] !== undefined);
    if (entries.length > 0) return Object.fromEntries(entries);
  }
  return undefined;
}

function parseInsights(response: InsightsResponse): Map<string, InsightValue> {
  const values = new Map<string, InsightValue>();
  for (const entry of response.data ?? []) {
    if (!entry.name) continue;
    const raw = entry.total_value?.value ?? entry.values?.at(-1)?.value;
    const value = parseValue(raw);
    if (value !== undefined) values.set(entry.name, value);
  }
  return values;
}

/**
 * Reads lifetime insights for one object. Meta rejects the whole request when
 * any requested metric is unsupported for that object (metrics differ by
 * media type and are deprecated over time), so on an invalid-metric error the
 * metrics are retried one by one and unsupported ones are skipped.
 */
export async function readMetaInsights(
  client: AxiosInstance,
  path: string,
  metrics: readonly string[],
  params: Record<string, string> = {},
): Promise<Map<string, InsightValue>> {
  const request = async (metric: string) => {
    const response = await client.get<InsightsResponse>(path, { params: { ...params, metric }, timeout: 20_000 });
    return parseInsights(response.data ?? {});
  };

  try {
    return await request(metrics.join(","));
  } catch (error) {
    if (!isInvalidMetricError(error) || metrics.length === 1) throw error;
  }

  const values = new Map<string, InsightValue>();
  for (const metric of metrics) {
    try {
      for (const [name, value] of await request(metric)) values.set(name, value);
    } catch (error) {
      if (!isInvalidMetricError(error)) throw error;
    }
  }
  return values;
}

/** A number insight, or the sum of a breakdown object. */
export function insightTotal(value: InsightValue | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  return Object.values(value).reduce((sum, entry) => sum + entry, 0);
}

/** Flattens insights into `platformMetrics` (breakdowns as `name.key`). */
export function flattenInsights(values: Map<string, InsightValue>, prefix = ""): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const [name, value] of values) {
    if (typeof value === "number") flat[`${prefix}${name}`] = value;
    else for (const [key, entry] of Object.entries(value)) flat[`${prefix}${name}.${key}`] = entry;
  }
  return flat;
}

/**
 * Runs an optional insights read. Missing permission or unsupported metrics
 * should not hide counters that were readable, so those errors return a
 * note instead of throwing.
 */
export async function optionalInsights(
  platformLabel: string,
  read: () => Promise<Map<string, InsightValue>>,
): Promise<{ values: Map<string, InsightValue>; note?: string }> {
  try {
    return { values: await read() };
  } catch (error) {
    const { status, message } = classifyAnalyticsError(error, platformLabel);
    if (status === "missing_permission" || isInvalidMetricError(error)) return { values: new Map(), note: message };
    throw error;
  }
}
