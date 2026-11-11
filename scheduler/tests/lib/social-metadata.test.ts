import { schedulerMetadata } from "@/lib/i18n/social-metadata";

describe("localized scheduler metadata", () => {
  it("isolates concurrent locale results and keeps the application unindexed", async () => {
    const [arabic, japanese] = await Promise.all([
      Promise.resolve().then(() => schedulerMetadata("ar", "https://app.example")),
      Promise.resolve().then(() => schedulerMetadata("ja", "https://app.example")),
    ]);
    expect(arabic.openGraph?.images).toEqual([expect.objectContaining({ url: "/social/ar/card.jpg" })]);
    expect(japanese.openGraph?.images).toEqual([expect.objectContaining({ url: "/social/ja/card.jpg" })]);
    expect(arabic.title).not.toBe(japanese.title);
    expect(arabic.description).not.toBe(japanese.description);
    expect(arabic.robots).toEqual({
      index: false,
      follow: false,
      googleBot: { index: false, follow: false, noarchive: true, nosnippet: true, noimageindex: true },
    });
    expect(arabic.twitter).toEqual({ card: "summary_large_image" });
  });
});
