import { readFileSync, writeFileSync, readdirSync } from "node:fs";

import ts from "typescript";

const sources = {},
  references = {};
function add(message, file, node, ast) {
  if (!message.trim()) return;
  sources[message] = message;
  (references[message] ??= []).push({ file, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 });
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(`${directory}/${entry.name}`)
      : /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)
        ? [`${directory}/${entry.name}`]
        : [],
  );
}
for (const file of ["app", "components", "features", "hooks", "lib", "mcp-ui"].flatMap((directory) =>
  files(directory),
)) {
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  // Backend copy has a separate catalog and completeness gate.
  const usesServerCopy = ast.statements.some(
    (node) =>
      ts.isImportDeclaration(node) &&
      /(?:^|\/)i18n\/server$/.test(node.moduleSpecifier.text) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.importClause.namedBindings.elements.some((entry) => entry.name.text === "createServerCopy"),
  );
  function visit(node) {
    if (
      !usesServerCopy &&
      ts.isCallExpression(node) &&
      ["copy", "sourceCopy"].includes(node.expression.getText(ast)) &&
      ts.isStringLiteralLike(node.arguments[0] ?? {})
    )
      add(node.arguments[0].text, file, node, ast);
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(ast) === "UiCopy") {
      const attribute = node.attributes.properties.find(
        (item) => ts.isJsxAttribute(item) && item.name.getText(ast) === "source",
      );
      const initializer = attribute?.initializer;
      const value = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
      if (value && ts.isStringLiteralLike(value)) add(value.text, file, node, ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
}
const plurals = JSON.parse(readFileSync("lib/i18n/copy-plurals.json", "utf8"));
for (const [message, singular] of Object.entries(plurals)) {
  if (!sources[message]) throw new Error(`Unused plural source: ${message}`);
  sources[`${message}_one`] = singular;
  sources[`${message}_other`] = message;
}
const result =
  JSON.stringify(Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))), null, 2) + "\n";
const target = "lib/i18n/copy/en.json";
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== result)
    throw new Error("UI copy source catalog is stale; run node scripts/extract-ui-copy.mjs");
} else writeFileSync(target, result);
const ref = process.argv.find((arg) => arg.startsWith("--references="));
if (ref) writeFileSync(ref.slice(13), JSON.stringify(references, null, 2) + "\n");
console.warn(
  `${Object.keys(sources).length} authored UI copy entries / ${Object.values(sources).join(" ").split(/\s+/).length} source words`,
);
