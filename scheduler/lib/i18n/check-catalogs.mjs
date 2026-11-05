import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const locales = "en es pt-BR fr de ja it ko zh-Hans zh-Hant ar hi id tr bg".split(" ");
const directory = new URL("./messages/", import.meta.url);
const load = (locale) => JSON.parse(readFileSync(new URL(`${locale}.json`, directory), "utf8"));
const placeholders = (message) => [...message.matchAll(/\{\{\s*([^}]+)\}\}/g)].map((match) => match[1].trim()).sort();

test("all supported UI catalogs cover the same messages and interpolation variables", () => {
  assert.deepEqual(readdirSync(directory).sort(), locales.map((locale) => `${locale}.json`).sort());
  const english = load("en");
  const keys = Object.keys(english).sort();
  for (const locale of locales) {
    const messages = load(locale);
    assert.deepEqual(Object.keys(messages).sort(), keys, locale);
    for (const [key, message] of Object.entries(messages)) {
      assert.ok(typeof message === "string" && message.trim(), `${locale}:${key} must have text`);
      assert.deepEqual(placeholders(message), placeholders(english[key]), `${locale}:${key}`);
    }
    if (locale !== "en") {
      assert.notEqual(messages.language, english.language, locale);
      assert.notDeepEqual(messages, english, locale);
    }
  }
});
