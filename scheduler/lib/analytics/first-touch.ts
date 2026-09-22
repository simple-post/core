/** Shared v1 cookie contract with the marketing repository. No visitor identifier. */
export const FIRST_TOUCH_COOKIE = "sp_first_touch_v1";
export const FIRST_TOUCH_MAX_AGE = 90 * 24 * 60 * 60;

export interface FirstTouch {
  version: 1;
  firstSeenAt: string;
  source: string;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
  landingPage: string;
}

function tag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().slice(0, 100);
  return clean && /^[\p{L}\p{N} _./:+-]+$/u.test(clean) ? clean : null;
}

function internalHost(host: string): boolean {
  return host === "simplepost.social" || host.endsWith(".simplepost.social");
}

/** Public route names only: never store auth tokens, draft IDs or arbitrary paths. */
function landingPage(url: URL): string {
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (url.hostname === "app.simplepost.social") {
    const route = path.split("/")[1];
    return ["schedule", "accounts", "billing", "subscribe", "settings", "compose"].includes(route)
      ? `/app/${route}`
      : "/app";
  }
  if (["/", "/clean", "/contact", "/privacy", "/terms", "/post-to-all-social-media-at-once"].includes(path))
    return path;
  if (/^\/tools\/(social-media|twitter|linkedin|instagram|facebook)-post-preview$/.test(path)) return path;
  return "/other";
}

export function createFirstTouch(href: string, referrer: string, now = new Date()): FirstTouch {
  const url = new URL(href);
  let source = "direct";
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!internalHost(host)) source = host;
  } catch {
    /* Empty or invalid referrer. */
  }
  return {
    version: 1,
    firstSeenAt: now.toISOString(),
    source: tag(url.searchParams.get("utm_source"))?.toLowerCase() || source,
    medium: tag(url.searchParams.get("utm_medium")),
    campaign: tag(url.searchParams.get("utm_campaign")),
    content: tag(url.searchParams.get("utm_content")),
    term: tag(url.searchParams.get("utm_term")),
    landingPage: landingPage(url),
  };
}

/** Treat attribution as untrusted marketing metadata, never as authorization. */
export function readFirstTouch(cookieHeader: string, now = new Date()): FirstTouch | null {
  const encoded = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${FIRST_TOUCH_COOKIE}=`))
    ?.slice(FIRST_TOUCH_COOKIE.length + 1);
  if (!encoded || encoded.length > 3500) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(encoded));
    if (!value || typeof value !== "object") return null;
    const data = value as Record<string, unknown>;
    if (data.version !== 1 || typeof data.firstSeenAt !== "string" || typeof data.landingPage !== "string") return null;
    const timestamp = Date.parse(data.firstSeenAt);
    const age = now.getTime() - timestamp;
    if (!Number.isFinite(timestamp) || age < -60_000 || age > FIRST_TOUCH_MAX_AGE * 1000) return null;
    const source = tag(data.source);
    if (!source) return null;
    // Reuse the route allowlist for values received from the cookie.
    const appPath = data.landingPage === "/app" || data.landingPage.startsWith("/app/");
    const safePage = landingPage(
      new URL(
        appPath ? data.landingPage.slice(4) || "/" : data.landingPage,
        appPath ? "https://app.simplepost.social" : "https://simplepost.social",
      ),
    );
    if (safePage !== data.landingPage) return null;
    return {
      version: 1,
      firstSeenAt: new Date(timestamp).toISOString(),
      source: source.toLowerCase(),
      medium: tag(data.medium),
      campaign: tag(data.campaign),
      content: tag(data.content),
      term: tag(data.term),
      landingPage: safePage,
    };
  } catch {
    return null;
  }
}

export function captureFirstTouch(): void {
  if (
    typeof window === "undefined" ||
    !["simplepost.social", "www.simplepost.social", "app.simplepost.social"].includes(window.location.hostname)
  )
    return;
  try {
    if (window.localStorage.getItem("plausible_ignore") === "true") return;
    if (readFirstTouch(document.cookie)) return;
    const touch = createFirstTouch(window.location.href, document.referrer);
    // Cookie Store API is not available in every supported browser.
    // eslint-disable-next-line unicorn/no-document-cookie
    document.cookie = `${FIRST_TOUCH_COOKIE}=${encodeURIComponent(JSON.stringify(touch))}; Max-Age=${FIRST_TOUCH_MAX_AGE}; Domain=simplepost.social; Path=/; SameSite=Lax; Secure`;
  } catch {
    /* Tracking must never prevent navigation or authentication. */
  }
}
