import { seoRoute } from "./landing-category";

/** Shared v1 cookie contract with the marketing repository. No visitor identifier. */
export const FIRST_TOUCH_COOKIE = "sp_first_touch_v1";
export const LAST_NON_DIRECT_COOKIE = "sp_last_non_direct_v1";
export const SIGNUP_ENTRY_COOKIE = "sp_signup_entry_v1";
export const ATTRIBUTION_VERSION = "first-and-last-v2";
export const SIGNUP_VERSION = "email-otp-v1";
export const ONBOARDING_VERSION = "assistant-first-v2";
export const MEASUREMENT_VERSION = "funnel-v2";
export type SignupEntryPoint = "web" | "assistant_authorize" | "cli_authorize";
const observedDocuments = new WeakSet<object>();
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
  sourceMethod?: "utm" | "referrer" | "link_tag" | "none";
}

function tag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim().slice(0, 100);
  return clean && /^[\p{L}\p{N} _./:+-]+$/u.test(clean) ? clean : null;
}

function internalHost(host: string): boolean {
  return (
    host === "simplepost.social" ||
    host.endsWith(".simplepost.social") ||
    ["accounts.google.com", "checkout.stripe.com", "billing.stripe.com", "hooks.stripe.com"].includes(host)
  );
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
  // Public SEO sections share one slug grammar with the website's copy of this contract.
  return seoRoute(path) ?? "/other";
}

export function createFirstTouch(href: string, referrer: string, now = new Date()): FirstTouch {
  const url = new URL(href);
  let source = "direct";
  let sourceMethod: FirstTouch["sourceMethod"] = "none";
  try {
    const host = new URL(referrer).hostname.toLowerCase().replace(/^www\./, "");
    if (!internalHost(host)) {
      source = host;
      sourceMethod = "referrer";
    }
  } catch {
    /* Empty or invalid referrer. */
  }
  const utmSource = tag(url.searchParams.get("utm_source"));
  const linkSource = tag(url.searchParams.get("ref")) || tag(url.searchParams.get("source"));
  if (utmSource || linkSource) {
    source = (utmSource || linkSource)!.toLowerCase();
    sourceMethod = utmSource ? "utm" : "link_tag";
  }
  return {
    version: 1,
    firstSeenAt: now.toISOString(),
    source,
    sourceMethod,
    medium: tag(url.searchParams.get("utm_medium")),
    campaign: tag(url.searchParams.get("utm_campaign")),
    content: tag(url.searchParams.get("utm_content")),
    term: tag(url.searchParams.get("utm_term")),
    landingPage: landingPage(url),
  };
}

/** Treat attribution as untrusted marketing metadata, never as authorization. */
export function readFirstTouch(
  cookieHeader: string,
  now = new Date(),
  cookieName = FIRST_TOUCH_COOKIE,
): FirstTouch | null {
  const encoded = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);
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
      ...(["utm", "referrer", "link_tag", "none"].includes(String(data.sourceMethod))
        ? { sourceMethod: data.sourceMethod as FirstTouch["sourceMethod"] }
        : {}),
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

/** Canonical source labels are for reporting; the original source remains stored. */
export function normalizeSource(source: string): string {
  const value = source.toLowerCase().replace(/^www\./, "");
  if (["chatgpt", "chatgpt.com", "chat.openai.com"].includes(value)) return "chatgpt";
  if (["claude", "claude.ai"].includes(value)) return "claude";
  if (["google", "google.com"].includes(value)) return "google";
  if (["x", "twitter", "x.com", "twitter.com", "t.co"].includes(value)) return "x";
  if (["linkedin", "linkedin.com", "lnkd.in"].includes(value)) return "linkedin";
  return value;
}

export function signupEntryPoint(href: string): SignupEntryPoint {
  const path = new URL(href).pathname;
  if (path === "/oauth/authorize") return "assistant_authorize";
  if (path === "/cli/authorize") return "cli_authorize";
  return "web";
}

export function acquisitionContext(cookieHeader: string) {
  const first = readFirstTouch(cookieHeader);
  const last = readFirstTouch(cookieHeader, new Date(), LAST_NON_DIRECT_COOKIE);
  const entry = cookieHeader
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SIGNUP_ENTRY_COOKIE}=`))
    ?.split("=")[1];
  return {
    ...(first || { version: 1, source: "unknown", reason: "no_valid_first_touch" }),
    ...(last && !["direct", "unknown"].includes(last.source) ? { lastNonDirect: last } : {}),
    signupEntryPoint: entry === "assistant_authorize" || entry === "cli_authorize" ? entry : "web",
    attributionVersion: ATTRIBUTION_VERSION,
    signupVersion: SIGNUP_VERSION,
    onboardingVersion: ONBOARDING_VERSION,
    measurementVersion: MEASUREMENT_VERSION,
  };
}

export function captureFirstTouch(): void {
  if (
    typeof window === "undefined" ||
    !["simplepost.social", "www.simplepost.social", "app.simplepost.social"].includes(window.location.hostname)
  )
    return;
  try {
    if (window.localStorage.getItem("plausible_ignore") === "true") return;
    const url = new URL(window.location.href);
    const initialDocument = !observedDocuments.has(document);
    observedDocuments.add(document);
    const touch = createFirstTouch(url.href, initialDocument ? document.referrer : "");
    const write = (name: string, value: string, maxAge: number) => {
      // eslint-disable-next-line unicorn/no-document-cookie
      document.cookie = `${name}=${value}; Max-Age=${maxAge}; Domain=simplepost.social; Path=/; SameSite=Lax; Secure`;
    };
    if (!readFirstTouch(document.cookie))
      write(FIRST_TOUCH_COOKIE, encodeURIComponent(JSON.stringify(touch)), FIRST_TOUCH_MAX_AGE);
    // Never replace first touch. A later campaign can qualify independently.
    // Do not re-use document.referrer on SPA navigation or repeat click captures.
    const callbackReturn =
      url.hostname === "app.simplepost.social" &&
      (url.pathname.startsWith("/api/") ||
        url.searchParams.has("checkout") ||
        ((url.pathname === "/accounts" || url.pathname === "/accounts/") &&
          (url.searchParams.has("success") || url.searchParams.has("error"))));
    if (!callbackReturn && !["direct", "unknown"].includes(touch.source)) {
      const previous = readFirstTouch(document.cookie, new Date(), LAST_NON_DIRECT_COOKIE);
      const same =
        previous &&
        ["source", "medium", "campaign", "content", "term", "landingPage"].every(
          (k) => previous[k as keyof FirstTouch] === touch[k as keyof FirstTouch],
        );
      if (!same || initialDocument)
        write(LAST_NON_DIRECT_COOKIE, encodeURIComponent(JSON.stringify(touch)), FIRST_TOUCH_MAX_AGE);
    }
    if (url.hostname === "app.simplepost.social") {
      const entry = signupEntryPoint(url.href);
      // Preserve assistant/CLI context through the login redirect in this browser.
      if (entry !== "web") write(SIGNUP_ENTRY_COOKIE, entry, 30 * 60);
    }
  } catch {
    /* Tracking must never prevent navigation or authentication. */
  }
}
