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

it("selects rich plurals using numeric counts without parsing interpolated user text", () => {
  const source = "{{count, number}} items for {{name}}: <part1>open</part1>";
  const render = (count: number) =>
    renderToStaticMarkup(
      createElement(UiLocaleProvider, {
        locale: "ar",
        messages: {
          [`${source}_one`]: "ONE {{count, number}} {{name}} <part1>OPEN</part1>",
          [`${source}_two`]: "TWO {{count, number}} {{name}} <part1>OPEN</part1>",
        },
        children: createElement(UiCopy, {
          source,
          values: { count, name: "User <part1>اسم</part1>" },
          components: { part1: createElement("a", { href: "/fixed", children: undefined }) },
        }),
      }),
    );
  expect(render(1)).toContain(`ONE ${new Intl.NumberFormat("ar").format(1)}`);
  expect(render(2)).toContain(`TWO ${new Intl.NumberFormat("ar").format(2)}`);
  expect(render(2)).toContain("User &lt;part1&gt;اسم&lt;/part1&gt;");
  expect(render(2)).toContain('<a href="/fixed">OPEN</a>');
});

it("renders opaque RSC scalar slots without assuming they have element props", () => {
  const source = "Year <part1></part1> — <part2></part2>";
  const html = renderToStaticMarkup(createElement(UiLocaleProvider, {
    locale: "en", messages: {}, children: createElement(UiCopy, {
      source, components: { part1: 2026, part2: "Preserve <tag>日本語</tag>" },
    }),
  }));
  expect(html).toContain("Year 2026");
  expect(html).toContain("Preserve &lt;tag&gt;日本語&lt;/tag&gt;");
});
