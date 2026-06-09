import { getPlatformById } from "@/lib/config";

export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

export function platformLabel(platform: string): string {
  return getPlatformById(platform.toLowerCase())?.name ?? platform;
}

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: "UTC",
  hour12: false,
});

/** Format an ISO datetime as a readable UTC date, e.g. "May 1, 2026 at 14:30 UTC". */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${DATE_FORMAT.format(date)} UTC`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
