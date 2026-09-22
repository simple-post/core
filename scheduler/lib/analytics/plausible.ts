type EventResult = { status?: number; error?: unknown } | undefined;

/** Hosted production only. Never send self-hosted, local or preview traffic. */
export function analyticsEnabled(): boolean {
  if (
    process.env.NODE_ENV !== "production" ||
    typeof window === "undefined" ||
    window.location.hostname !== "app.simplepost.social"
  )
    return false;
  try {
    return window.localStorage.getItem("plausible_ignore") !== "true";
  } catch {
    // If the preference cannot be read, skip optional analytics.
    return false;
  }
}

/** Collapse dynamic IDs and exclude every query parameter except campaign tags. */
export function analyticsUrl(href: string): string {
  const source = new URL(href);
  const segments = source.pathname.split("/").filter(Boolean);
  const publicRoutes = new Set([
    "schedule",
    "accounts",
    "billing",
    "subscribe",
    "settings",
    "posts",
    "compose",
    "integrations",
    "login",
    "calendar",
  ]);
  const route = publicRoutes.has(segments[0]) ? segments[0] : "other";
  const path =
    segments.length === 0 ? "/app" : `/app/${route}${route === "billing" && segments[1] === "plans" ? "/plans" : ""}`;
  const clean = new URL(path, source.origin);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const value = source.searchParams.get(key);
    if (value) clean.searchParams.set(key, value.slice(0, 150));
  }
  return clean.href;
}

export function trackEvent(
  name: string,
  props?: Record<string, string>,
  callback?: (result?: EventResult) => void,
): void {
  if (!analyticsEnabled()) {
    callback?.();
    return;
  }
  try {
    // Send directly so both the page URL and referrer are scrubbed before transmission.
    // The browser supplies its normal User-Agent/IP, preserving Plausible attribution.
    let referrer = "";
    try {
      referrer = document.referrer ? new URL(document.referrer).origin : "";
    } catch {
      /* No referrer. */
    }
    void fetch("https://api.simplepost.social/api/event", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      credentials: "omit",
      referrerPolicy: "no-referrer",
      keepalive: true,
      body: JSON.stringify({
        name,
        domain: "simplepost.social",
        url: analyticsUrl(window.location.href),
        referrer,
        props,
        interactive: !["App Opened", "Authenticated Visit"].includes(name),
      }),
    })
      .then((response) => callback?.({ status: response.status }))
      .catch((error: unknown) => callback?.({ error }));
  } catch {
    // Analytics must never prevent authentication, checkout or app rendering.
    callback?.();
  }
}

const pending = new Set<string>();
const delivered = new Set<string>();
/** IDs are used locally for deduplication only, and are never sent to Plausible. */
export function trackOnce(key: string, name: string, props?: Record<string, string>, persistent = false): void {
  if (!analyticsEnabled() || pending.has(key) || delivered.has(key)) return;
  const storageKey = `simplepost:analytics:${key}`;
  let storage: Storage | undefined;
  try {
    storage = persistent ? window.localStorage : window.sessionStorage;
    if (storage.getItem(storageKey)) return;
  } catch {
    /* Storage may be disabled. In-memory deduplication still works. */
  }
  pending.add(key);
  trackEvent(name, props, (result) => {
    pending.delete(key);
    if (!result?.status || result.status < 200 || result.status >= 300) return;
    delivered.add(key);
    try {
      storage?.setItem(storageKey, "1");
    } catch {
      /* Best effort. */
    }
  });
}
