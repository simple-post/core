import { SOCIAL_PLATFORMS } from "@/lib/config";

const PLATFORM_ALIASES: Record<string, string> = {
  twitter: "x",
};

export function normalizePlatformId(platform: string) {
  const normalized = platform.toLowerCase();
  return PLATFORM_ALIASES[normalized] ?? normalized;
}

export function getPlatformConfig(platform: string) {
  const normalized = normalizePlatformId(platform);
  return SOCIAL_PLATFORMS.find((entry) => entry.id === normalized);
}

export function getPlatformLabel(platform: string) {
  return getPlatformConfig(platform)?.name ?? platform;
}
