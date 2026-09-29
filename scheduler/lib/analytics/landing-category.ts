/**
 * Landing-page categories for SEO attribution. The same route rules are mirrored in
 * website-social/lib/seo/categories.ts; keep both copies identical.
 */
export const LANDING_CATEGORIES = ["platform", "ai_client", "guide", "tool", "comparison", "mcp", "pricing", "about"] as const;

export type LandingCategory = (typeof LANDING_CATEGORIES)[number];

/** Standalone workflow tutorials that predate the /guides/ section. */
export const LEGACY_GUIDE_PATHS = [
  "/instagram-from-chatgpt",
  "/social-media-scheduling-with-claude",
  "/post-to-all-social-media-at-once",
] as const;

export const MCP_PATHS = ["/social-media-mcp-server", "/social-media-scheduler-for-ai-agents"] as const;

/** Commercial pages that get their own category. */
export const PRICING_PATHS = ["/pricing"] as const;

/** Company / trust pages. */
export const ABOUT_PATHS = ["/about"] as const;

const SECTION_CATEGORIES: Record<string, LandingCategory> = {
  platforms: "platform",
  ai: "ai_client",
  guides: "guide",
  tools: "tool",
  compare: "comparison",
};

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+){0,11}";
const SECTION_ROUTE = new RegExp(`^/(platforms|ai|guides|tools|compare)(?:/(${SLUG}))?$`);

/** Normalizes to the route shape stored in attribution: no trailing slash, `/` for home. */
export function normalizeRoute(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/** A public SEO route shape, or null for anything else (IDs, queries and unknown paths). */
export function seoRoute(pathname: string): string | null {
  const path = normalizeRoute(pathname);
  if (path.length > 100) return null;
  if ((LEGACY_GUIDE_PATHS as readonly string[]).includes(path)) return path;
  if ((MCP_PATHS as readonly string[]).includes(path)) return path;
  if ((PRICING_PATHS as readonly string[]).includes(path)) return path;
  if ((ABOUT_PATHS as readonly string[]).includes(path)) return path;
  return SECTION_ROUTE.test(path) ? path : null;
}

export function landingCategory(pathname: string): LandingCategory | null {
  const path = seoRoute(pathname);
  if (!path) return null;
  if ((LEGACY_GUIDE_PATHS as readonly string[]).includes(path)) return "guide";
  if ((MCP_PATHS as readonly string[]).includes(path)) return "mcp";
  if ((PRICING_PATHS as readonly string[]).includes(path)) return "pricing";
  if ((ABOUT_PATHS as readonly string[]).includes(path)) return "about";
  return SECTION_CATEGORIES[path.split("/")[1]] ?? null;
}
