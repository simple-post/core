import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import ts from "typescript";

const directory = "lib/i18n/server-messages";
const locales = "en es pt-BR fr de ja it ko zh-Hans zh-Hant ar hi id tr bg".split(" ");
const english = JSON.parse(readFileSync(`${directory}/en.json`, "utf8"));
const plurals = JSON.parse(readFileSync("lib/i18n/server-plurals.json", "utf8"));
const variables = (value) => [...value.matchAll(/\{\{\s*([^}]+)\s*\}\}/g)].map((match) => match[1].trim()).sort();
const tags = (value) => [...value.matchAll(/<\/?part\d+>/g)].map((match) => match[0]).sort();
assert.deepEqual(
  readdirSync(directory).sort(),
  locales.map((locale) => `${locale}.json`).sort(),
  "All target server catalogs are required",
);
const registryAst = ts.createSourceFile(
  "server-catalogs.ts",
  readFileSync("lib/i18n/server-catalogs.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
let registered = [];
function inspect(node) {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(registryAst) === "serverCatalogs" &&
    ts.isObjectLiteralExpression(node.initializer)
  ) {
    registered = node.initializer.properties.map((property) => property.name.text);
  }
  ts.forEachChild(node, inspect);
}
inspect(registryAst);
assert.deepEqual(registered.sort(), [...locales].sort(), "Complete server catalogs must also be loaded at runtime");
for (const locale of locales) {
  const messages = JSON.parse(readFileSync(`${directory}/${locale}.json`, "utf8"));
  const expected = new Set(Object.keys(english));
  for (const base of plurals) {
    expected.delete(`${base}_one`);
    expected.delete(`${base}_other`);
    for (const category of new Intl.PluralRules(locale).resolvedOptions().pluralCategories)
      expected.add(`${base}_${category}`);
  }
  assert.deepEqual(Object.keys(messages).sort(), [...expected].sort(), `${locale}: server coverage`);
  for (const [key, value] of Object.entries(messages)) {
    assert.ok(typeof value === "string" && value.trim(), `${locale}:${key}`);
    const base = plurals.find((source) => key.startsWith(`${source}_`));
    assert.deepEqual(variables(value), variables(english[base ?? key]), `${locale}:${key}: variables`);
    assert.deepEqual(tags(value), tags(english[base ?? key]), `${locale}:${key}: React slots`);
  }
  if (locale !== "en") assert.notDeepEqual(messages, english, `${locale}: copied English is not a translation`);
}
console.warn(`Complete server overlays validated for ${locales.length} locales`);
