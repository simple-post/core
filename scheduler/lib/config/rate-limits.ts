export interface PlatformRateLimit {
  maxPostsPerDay: number;
}

export const PLATFORM_RATE_LIMITS: Record<string, PlatformRateLimit> = {
  x: { maxPostsPerDay: 50 },
  youtube: { maxPostsPerDay: 2 },
  facebook: { maxPostsPerDay: 10 },
  instagram: { maxPostsPerDay: 10 },
  telegram: { maxPostsPerDay: 50 },
  tiktok: { maxPostsPerDay: 5 },
  bluesky: { maxPostsPerDay: 50 },
  threads: { maxPostsPerDay: 25 },
  linkedin: { maxPostsPerDay: 5 },
  pinterest: { maxPostsPerDay: 50 },
};
