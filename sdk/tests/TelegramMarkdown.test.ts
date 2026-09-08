import { validateContentForPlatform } from "../src/validation";
import { telegramMarkdown } from "../src/validation/telegram-markdown";

it.each([
  ["*bold* _italic_ __underline__ ~strike~ ||hidden||", "bold italic underline strike hidden"],
  ["*bold _nested_*", "bold nested"],
  [String.raw`[link](https://example.com/path\))`, "link"],
  ["`a_b.*`", "a_b.*"],
  ["```js\na_b.*\n```", "a_b.*\n"],
  [String.raw`escaped\. literal\!`, "escaped. literal!"],
  [">quote\n>continued\nplain", "quote\ncontinued\nplain"],
  [">expandable||", "expandable"],
  ["![😀](tg://emoji?id=123)", "😀"],
  ["___italic underline_\r__", "italic underline\r"],
])("parses Telegram MarkdownV2 %s", (source, text) => expect(telegramMarkdown(source)).toEqual({ text }));
it.each([
  "unescaped.",
  "*unclosed",
  "[link](broken",
  "*bad _nesting*",
  "![😀](https://example.com)",
  "[unclosed",
  ">*quote\nplain",
  "a > b",
])("rejects malformed MarkdownV2 %s", (source) => expect(telegramMarkdown(source).error).toBeDefined());
it("handles legacy markup without applying MarkdownV2 reserved punctuation", () => {
  expect(telegramMarkdown("*bold* and [link](https://example.com).", true)).toEqual({ text: "bold and link." });
  expect(telegramMarkdown("_unclosed", true).error).toBeDefined();
});
it("counts parsed text rather than formatting or hidden URLs", () => {
  const result = validateContentForPlatform(
    "telegram",
    { text: `*${"a".repeat(4096)}*` },
    { telegram: { chatId: "1", parseMode: "MarkdownV2" } },
  );
  expect(result.isValid).toBe(true);
});
