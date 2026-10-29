/** Shared browser contract with website-social. No advertising storage before permission. */
export const ADS_PREFERENCE_COOKIE = "sp_ads_permission_v1";
export const ADS_CLICK_COOKIE = "sp_ads_click_v1";
export const ADS_CLICK_MAX_AGE = 30 * 86_400;
export const ADS_PREFERENCE_MAX_AGE = 180 * 86_400;

function validReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 2000 &&
    ![...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point < 32 || point === 127;
    })
  );
}

function cookieValue(header: string, name: string): string | null {
  const value = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  if (!value) return null;
  try {
    return decodeURIComponent(value.slice(name.length + 1));
  } catch {
    return null;
  }
}

export function readAdsPreference(header: string): "allowed" | "declined" | null {
  const value = cookieValue(header, ADS_PREFERENCE_COOKIE);
  return value === "allowed" || value === "declined" ? value : null;
}

export function readAdsClick(header: string, now = new Date()): { reference: string; capturedAt: Date } | null {
  if (readAdsPreference(header) !== "allowed") return null;
  const value = cookieValue(header, ADS_CLICK_COOKIE);
  if (!value || value.length > 2500) return null;
  try {
    const data = JSON.parse(value);
    const timestamp = Date.parse(data.capturedAt);
    if (
      !validReference(data.reference) ||
      !Number.isFinite(timestamp) ||
      timestamp > now.getTime() ||
      now.getTime() - timestamp >= ADS_CLICK_MAX_AGE * 1000
    )
      return null;
    return { reference: data.reference, capturedAt: new Date(timestamp) };
  } catch {
    return null;
  }
}

function supportedBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    ["simplepost.social", "www.simplepost.social", "app.simplepost.social"].includes(window.location.hostname)
  );
}

function setCookie(name: string, value: string, age: number) {
  // Cookie Store API is not available in every supported browser.
  // eslint-disable-next-line unicorn/no-document-cookie
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${age}; Domain=simplepost.social; Path=/; SameSite=Lax; Secure`;
}

export function saveAdsPreference(allowed: boolean): void {
  if (!supportedBrowser()) return;
  setCookie(ADS_PREFERENCE_COOKIE, allowed ? "allowed" : "declined", ADS_PREFERENCE_MAX_AGE);
  if (allowed) captureAdsClick();
  else {
    setCookie(ADS_CLICK_COOKIE, "", 0);
    for (const name of ["__oppref", "__obref"]) {
      setCookie(name, "", 0);
      // Also clear host-only cookies if a previous pixel integration set them.
      // eslint-disable-next-line unicorn/no-document-cookie
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
    }
  }
}

export function captureAdsClick(): void {
  if (!supportedBrowser() || readAdsPreference(document.cookie) !== "allowed") return;
  try {
    const reference = new URL(window.location.href).searchParams.get("oppref");
    if (!validReference(reference)) return;
    if (readAdsClick(document.cookie)?.reference === reference) return;
    // Preserve the opaque value exactly; keep the most recent click for 30 days.
    setCookie(ADS_CLICK_COOKIE, JSON.stringify({ reference, capturedAt: new Date().toISOString() }), ADS_CLICK_MAX_AGE);
  } catch {
    /* Measurement must never prevent navigation. */
  }
}
