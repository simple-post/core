import type { PostMetric } from "@simple-post/sdk/analytics";

/** 1234 → "1.2K" (locale-aware). Small numbers keep full precision. */
export function formatCompact(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) < 10_000) return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatNumber(value: number | null | undefined, locale: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(rate: number | null | undefined, locale: string, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return "—";
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: digits }).format(rate);
}

/** Seconds → "1 hr, 5 min" style durations using the locale's unit names. */
export function formatDuration(seconds: number | null | undefined, locale: string): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const unit = (value: number, name: "hour" | "minute" | "second") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: name,
      unitDisplay: "narrow",
      maximumFractionDigits: 1,
    }).format(value);
  if (seconds < 60) return unit(Math.round(seconds * 10) / 10, "second");
  if (seconds < 3600) return unit(Math.round(seconds / 6) / 10, "minute");
  return unit(Math.round(seconds / 360) / 10, "hour");
}

export function formatMetricValue(
  metric: PostMetric | "engagements",
  value: number | null | undefined,
  locale: string,
) {
  if (metric === "watchTimeSeconds" || metric === "averageWatchTimeSeconds") return formatDuration(value, locale);
  return formatCompact(value, locale);
}

/** Relative change (0.12 → "+12%"). */
export function formatChange(change: number | null | undefined, locale: string): string | null {
  if (change === null || change === undefined || !Number.isFinite(change)) return null;
  const formatted = new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: Math.abs(change) < 0.1 ? 1 : 0,
    signDisplay: "exceptZero",
  }).format(change);
  return formatted;
}

export function formatRelativeTime(iso: string | null | undefined, locale: string, now = Date.now()): string | null {
  if (!iso) return null;
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const abs = Math.abs(seconds);
  if (abs < 60) return format.format(seconds, "second");
  if (abs < 3600) return format.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return format.format(Math.round(seconds / 3600), "hour");
  return format.format(Math.round(seconds / 86_400), "day");
}
