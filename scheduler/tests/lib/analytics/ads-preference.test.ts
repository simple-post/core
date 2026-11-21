import {
  captureAdsClick,
  saveAdsPreference,
  readAdsClick,
  readAdsPreference,
  ADS_CLICK_COOKIE,
  ADS_CLICK_MAX_AGE,
} from "@/lib/analytics/ads-preference";
const now = new Date("2026-10-29T12:00:00Z");
function cookie(reference: unknown = "Opaque+/unchanged==", capturedAt = now.toISOString(), permission = "allowed") {
  return `sp_ads_permission_v1=${permission}; ${ADS_CLICK_COOKIE}=${encodeURIComponent(JSON.stringify({ reference, capturedAt }))}`;
}
it("keeps opaque click data unchanged across website-to-app navigation", () => {
  expect(readAdsClick(cookie(), now)).toEqual({ reference: "Opaque+/unchanged==", capturedAt: now });
  expect(readAdsPreference("sp_ads_permission_v1=not-allowed")).toBeNull();
});
it.each(["declined", "", "bogus"])("rejects click data when permission is %s", (value) => {
  expect(readAdsClick(cookie(undefined, undefined, value), now)).toBeNull();
});
it.each([null, 42, "", "a".repeat(2001), "a\nb"])("rejects malformed references: %s", (reference) => {
  expect(readAdsClick(cookie(reference), now)).toBeNull();
});
it("rejects malformed, future and expired click cookies", () => {
  expect(readAdsClick("sp_ads_permission_v1=allowed; sp_ads_click_v1=%oops", now)).toBeNull();
  expect(readAdsClick(cookie("ref", new Date(now.getTime() + 1).toISOString()), now)).toBeNull();
  expect(readAdsClick(cookie("ref", new Date(now.getTime() - ADS_CLICK_MAX_AGE * 1000).toISOString()), now)).toBeNull();
});
it("does not store a click before permission; grant captures it and withdrawal clears it", () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const values = new Map<string, string>();
  const writes: string[] = [];
  const doc = {
    get cookie() {
      return [...values].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(value: string) {
      writes.push(value);
      const [key, valuePart] = value.split(";")[0].split("=");
      if (value.includes("Max-Age=0;")) values.delete(key);
      else values.set(key, valuePart);
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: new URL("https://simplepost.social/ai/chatgpt/?oppref=Opaque%2B%2Funchanged%3D%3D") },
  });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  try {
    captureAdsClick();
    expect(writes).toHaveLength(0);
    saveAdsPreference(true);
    expect(readAdsClick(doc.cookie)?.reference).toBe("Opaque+/unchanged==");
    expect(writes.every((value) => value.includes("Secure") && value.includes("SameSite=Lax"))).toBe(true);
    saveAdsPreference(false);
    expect(readAdsClick(doc.cookie)).toBeNull();
    expect(readAdsPreference(doc.cookie)).toBe("declined");
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
