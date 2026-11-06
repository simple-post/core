import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        !["node_modules", "dist", "tests", "messages", "copy", "server-messages", "social-messages"].includes(
          entry.name,
        )
      )
        walk(file);
    } else if (/\.tsx?$/.test(file) && !file.endsWith(".d.ts")) files.push(file);
  }
}
for (const directory of ["lib", "app/api", "app/mcp", "types", "../sdk/src/types"]) walk(path.join(root, directory));
const parsed = files.map((file) =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  ),
);
const declarations = new Map();
for (const sf of parsed) {
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      const entries = declarations.get(name) ?? [];
      entries.push(node.initializer);
      declarations.set(name, entries);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
function strings(node, seen = new Set()) {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
    return strings(node.expression, seen);
  if (ts.isIdentifier(node) && !seen.has(node.text)) {
    const candidates = declarations.get(node.text) ?? [];
    if (candidates.length === 1) return strings(candidates[0], new Set([...seen, node.text]));
  }
  if (ts.isConditionalExpression(node)) return [...strings(node.whenTrue, seen), ...strings(node.whenFalse, seen)];
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken)
    return strings(node.left, seen).flatMap((a) => strings(node.right, seen).map((b) => a + b));
  if (ts.isTemplateExpression(node)) {
    let result = [node.head.text];
    for (const span of node.templateSpans)
      result = result.flatMap((a) => strings(span.expression, seen).map((b) => a + b + span.literal.text));
    return result;
  }
  return [];
}
const sources = new Map();
function add(node, sf) {
  for (const source of strings(node)) {
    if (!source.trim()) continue;
    const where = `${path.relative(root, sf.fileName)}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`;
    const refs = sources.get(source) ?? new Set();
    refs.add(where);
    sources.set(source, refs);
  }
}
for (const sf of parsed) {
  const file = path.relative(root, sf.fileName).replaceAll("\\", "/");
  const mcp = file.startsWith("lib/mcp/");
  const openapi = file.endsWith("/openapi.ts") || file.startsWith("lib/openapi/");
  const copied =
    file === "lib/notifications/disconnect-email.ts" ||
    file === "app/mcp/route.ts" ||
    file === "lib/i18n/schema-display.ts" ||
    file === "lib/utils/errors.ts";
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(sf);
      if (["serverT", "serverMessage"].includes(name) || (copied && name === "copy")) add(node.arguments[0], sf);
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "describe" &&
        (mcp || file.startsWith("lib/validations/") || file.startsWith("../sdk/src/types/"))
      )
        add(node.arguments[0], sf);
    }
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(sf).replaceAll(/["']/g, "");
      if (
        (mcp || openapi) &&
        ["title", "description", "summary", "openai/toolInvocation/invoking", "openai/toolInvocation/invoked"].includes(
          key,
        )
      )
        add(node.initializer, sf);
      if (
        (file.startsWith("lib/validations/") || file.startsWith("../sdk/src/types/")) &&
        ["message", "error"].includes(key)
      )
        add(node.initializer, sf);
      // JSON contract values/examples must never become translation sources.
      if (openapi && ["example", "examples", "default", "enum", "const"].includes(key)) return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      if (mcp && /(?:INSTRUCTIONS|DESCRIPTION)$/.test(node.name.text)) add(node.initializer, sf);
      if (
        mcp &&
        ["MIME_LABEL", "EXTENSION_TOOL_DESCRIPTIONS"].includes(node.name.text) &&
        node.initializer &&
        ts.isObjectLiteralExpression(node.initializer)
      ) {
        for (const field of node.initializer.properties) if (ts.isPropertyAssignment(field)) add(field.initializer, sf);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
const plurals = JSON.parse(readFileSync(path.join(root, "lib/i18n/server-plurals.json"), "utf8"));
const current = JSON.parse(readFileSync(path.join(root, "lib/i18n/server-messages/en.json"), "utf8"));
const catalog = Object.fromEntries([...sources.keys()].sort().map((source) => [source, source]));
for (const base of plurals)
  for (const category of ["one", "other"]) catalog[`${base}_${category}`] = current[`${base}_${category}`];
const output = JSON.stringify(catalog, null, 2) + "\n";
const sourceMap =
  JSON.stringify(
    Object.fromEntries(
      [...sources].sort(([a], [b]) => a.localeCompare(b)).map(([source, refs]) => [source, [...refs].sort()]),
    ),
    null,
    2,
  ) + "\n";
if (process.argv.includes("--check")) {
  if (readFileSync(path.join(root, "lib/i18n/server-messages/en.json"), "utf8") !== output)
    throw new Error("Server source catalog is stale; run extract-server-source.mjs.");
} else {
  writeFileSync(path.join(root, "lib/i18n/server-messages/en.json"), output);
  writeFileSync(path.join(root, "lib/i18n/server-source-map.json"), sourceMap);
}
console.warn(
  `${Object.keys(catalog).length} authored server entries; ${Object.values(catalog).join(" ").split(/\s+/).length} source words.`,
);
