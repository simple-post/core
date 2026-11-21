import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const locales = "en es pt-BR fr de ja it ko zh-Hans zh-Hant ar hi id tr bg".split(" ");
const directory = new URL("messages/", import.meta.url);
const load = (locale) => JSON.parse(readFileSync(new URL(`${locale}.json`, directory), "utf8"));
const pluralKeys = ["calendarItemCount"];
const pluralVariant = new RegExp(`^(${pluralKeys.join("|")})_(zero|one|two|few|many|other)$`);
const placeholders = (message) => [...message.matchAll(/\{\{\s*([^}]+)\}\}/g)].map((match) => match[1].trim()).sort();

test("all supported UI catalogs cover the same messages and interpolation variables", () => {
  assert.deepEqual(readdirSync(directory).sort(), locales.map((locale) => `${locale}.json`).sort());
  const english = load("en");
  const keys = Object.keys(english).filter((key) => !pluralVariant.test(key));
  for (const locale of locales) {
    const messages = load(locale);
    const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
    const variants = pluralKeys.flatMap((key) => categories.map((category) => `${key}_${category}`));
    assert.deepEqual(Object.keys(messages).sort(), [...keys, ...variants].sort(), locale);
    for (const [key, message] of Object.entries(messages)) {
      assert.ok(typeof message === "string" && message.trim(), `${locale}:${key} must have text`);
      const [, base, category] = key.match(pluralVariant) ?? [];
      const expected =
        locale === "ar" && base && ["zero", "one", "two"].includes(category)
          ? [] // These Arabic noun forms already express the count.
          : placeholders(english[base ?? key]);
      assert.deepEqual(placeholders(message), expected, `${locale}:${key}`);
    }
    if (locale !== "en") {
      assert.notEqual(messages.language, english.language, locale);
      assert.notDeepEqual(messages, english, locale);
    }
  }
});
