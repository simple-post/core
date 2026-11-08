import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import ts from "typescript";

const directory = "lib/i18n/server-messages";
const locales = "en es pt-BR fr de ja it ko zh-Hans zh-Hant ar hi id tr bg".split(" ");
const english = JSON.parse(readFileSync(`${directory}/en.json`, "utf8"));
const allowInstructionsFallback = process.argv.includes("--allow-mcp-instructions-fallback");
const serverSource = ts.createSourceFile(
  "server.ts",
  readFileSync("lib/mcp/server.ts", "utf8"),
  ts.ScriptTarget.Latest,
  true,
);
const instructions = serverSource.statements
  .filter((statement) => ts.isVariableStatement(statement))
  .flatMap((statement) => [...statement.declarationList.declarations])
  .find((declaration) => declaration.name.getText(serverSource) === "SERVER_INSTRUCTIONS")?.initializer;
assert.ok(instructions && (ts.isNoSubstitutionTemplateLiteral(instructions) || ts.isTemplateExpression(instructions)));
const instructionsPrefix = ts.isTemplateExpression(instructions) ? instructions.head.text : instructions.text;
const instructionSources = Object.keys(english).filter((source) => source.startsWith(instructionsPrefix));
assert.equal(instructionSources.length, 1, "The MCP instruction fallback must match exactly one extracted source");
const [instructionSource] = instructionSources;
const fallbackLocales = [];
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
  if (locale !== "en" && allowInstructionsFallback && !Object.hasOwn(messages, instructionSource)) {
    expected.delete(instructionSource);
    fallbackLocales.push(locale);
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
if (fallbackLocales.length > 0) {
  console.warn(
    `Server overlays validated for ${locales.length} locales. MCP instructions use English in ${fallbackLocales.join(", ")}.`,
  );
} else {
  console.warn(`Complete server overlays validated for ${locales.length} locales`);
}
