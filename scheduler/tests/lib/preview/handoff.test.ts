import { decodePreview, parsePreview, readStoredPreview, PREVIEW_TTL } from "@/lib/preview/handoff";
const payload = {
  version: 1,
  variants: [{ platform: "x", message: "Hello 🌍 & #news", thread: ["Follow-up"] }],
  hasMedia: true,
};
describe("preview transfer boundary", () => {
  it("preserves unicode, line breaks and threads while discarding unknown fields", () => {
    expect(
      decodePreview(
        `#preview=${encodeURIComponent(JSON.stringify({ ...payload, accountId: "not-trusted", publish: true }))}`,
      ),
    ).toEqual(payload);
  });
  it.each([
    { ...payload, version: 2 },
    { ...payload, variants: [] },
    { ...payload, variants: [payload.variants[0], payload.variants[0]] },
    { ...payload, variants: [{ ...payload.variants[0], platform: "__proto__" }] },
    { ...payload, variants: [{ ...payload.variants[0], message: "a".repeat(10_001) }] },
    { ...payload, variants: [{ ...payload.variants[0], thread: Array.from({ length: 20 }).fill("a") }] },
  ])("rejects malformed or excessive payloads", (value) => expect(() => parsePreview(value)).toThrow());
  it("rejects expired and implausibly long-lived browser copies", () => {
    const now = 1000;
    expect(readStoredPreview(JSON.stringify({ preview: payload, expiresAt: now + PREVIEW_TTL }), now)).toEqual(payload);
    for (const expiresAt of [now, now - 1, now + PREVIEW_TTL + 1, "tomorrow"])
      expect(() => readStoredPreview(JSON.stringify({ preview: payload, expiresAt }), now)).toThrow();
  });
  it("rejects malformed fragments", () => {
    for (const hash of ["", "#other=x", "#preview=%", "#preview=null"]) expect(() => decodePreview(hash)).toThrow();
  });
});
