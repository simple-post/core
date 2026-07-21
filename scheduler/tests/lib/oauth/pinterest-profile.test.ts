import { extractPinterestDisplayName } from "@/lib/oauth/pinterest-profile";

describe("extractPinterestDisplayName", () => {
  it("reads the public profile name from Pinterest page data", () => {
    const html = '<script>{"username":"eclompton","full_name":"Edmund Clompton"}</script>';

    expect(extractPinterestDisplayName(html, "eclompton")).toBe("Edmund Clompton");
  });

  it("falls back to the Pinterest profile title and decodes entities", () => {
    const html = "<title>Edmund &amp; Clompton (eclompton) - Profile | Pinterest</title>";

    expect(extractPinterestDisplayName(html, "eclompton")).toBe("Edmund & Clompton");
  });

  it("does not treat the username as a distinct display name", () => {
    const html = "<title>eclompton (eclompton) - Profile | Pinterest</title>";

    expect(extractPinterestDisplayName(html, "eclompton")).toBeNull();
  });
});
