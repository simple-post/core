import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { UiCopy } from "@/components/ui-copy";
import { UiLocaleProvider } from "@/lib/i18n/client";
import { createTranslator } from "@/lib/i18n/translate";

describe("authored UI copy overlays", () => {
  it("keeps count and locale formatting request-scoped", () => {
    const french = createTranslator("fr", {
      "{{count}} days left_one": "ONE {{count, number}}",
      "{{count}} days left_other": "MANY {{count, number}}",
    });
    const japanese = createTranslator("ja", { "{{count}} days left_other": "JA {{count, number}}" });
    expect(french("{{count}} days left", { count: 1 })).toBe("ONE 1");
    expect(french("{{count}} days left", { count: 2 })).toBe("MANY 2");
    expect(japanese("{{count}} days left", { count: 1000 })).toBe("JA 1,000");
    expect(createTranslator("en", {})("{{count}} days left", { count: 1 })).toBe("1 day left");
  });

  it("reorders authored rich text while preserving user slots and fixed link destinations", () => {
    const source = "Name <part1></part1>, then <part2>open</part2>.";
    const node = createElement(UiCopy, {
      source,
      components: {
        part1: createElement("span", null, "User <part2>日本語</part2>"),
        part2: createElement("a", { href: "/fixed", children: "open" }),
      },
    });
    const html = renderToStaticMarkup(
      createElement(UiLocaleProvider, {
        locale: "ar",
        messages: { [source]: "<part2>LINK</part2> <part1>must not replace the user slot</part1>" },
        children: node,
      }),
    );
    expect(html).toContain('<a href="/fixed">LINK</a>');
    expect(html).toContain("User &lt;part2&gt;日本語&lt;/part2&gt;");
    expect(html).not.toContain("must not replace");
    expect(html.indexOf("LINK")).toBeLessThan(html.indexOf("User"));
  });
});
