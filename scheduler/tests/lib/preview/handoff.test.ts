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
    { ...payload, variants: [{ ...payload.variants[0], message: "a".repeat(126_413) }] },
    { ...payload, variants: [{ ...payload.variants[0], thread: Array.from({ length: 25 }).fill("a") }] },
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
  it("keeps a known tool source and drops unknown ones without rejecting the draft", () => {
    expect(parsePreview({ ...payload, source: "thread-generator" })).toEqual({
      ...payload,
      source: "thread-generator",
    });
    expect(parsePreview({ ...payload, source: "<script>" })).toEqual(payload);
    expect(parsePreview({ ...payload, source: 42 })).toEqual(payload);
  });
});

describe("extended website transfer compatibility", () => {
  it("accepts long posts and 25-post threads without truncation", () => {
    const variants = [
      { platform: "facebook", message: "🌍".repeat(63_206), thread: [] },
      { platform: "x", message: "a".repeat(25_000), thread: Array.from({ length: 24 }, () => "reply") },
    ];
    const input = { version: 1, variants, hasMedia: false };
    expect(decodePreview(`#preview=${encodeURIComponent(JSON.stringify(input))}`)).toEqual(input);
  });
  it("bounds total payload size across individually valid posts", () => {
    expect(() =>
      parsePreview({
        ...payload,
        variants: [{ platform: "facebook", message: "a".repeat(120_000), thread: ["a".repeat(120_000)] }],
      }),
    ).toThrow();
  });
});
