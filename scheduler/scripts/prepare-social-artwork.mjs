import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

import React from "react";

import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const require = createRequire(import.meta.url),
  outputModule = { exports: {} };
const input = readFileSync("components/social-artwork.tsx", "utf8");
const compiled = ts.transpileModule(input, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;
vm.runInNewContext(compiled, { module: outputModule, exports: outputModule.exports, require });
const Artwork = outputModule.exports.default;
const manifest = JSON.parse(readFileSync("lib/i18n/social-assets.json", "utf8"));
const locales =
  process.argv
    .find((arg) => arg.startsWith("--locales="))
    ?.slice(10)
    .split(",") ?? Object.keys(manifest.locales);
const directory = path.resolve(process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ?? "artwork-preview");
mkdirSync(directory, { recursive: true });
for (const locale of locales) {
  assert.ok(Object.hasOwn(manifest.locales, locale), `Unknown locale: ${locale}`);
  const messages = JSON.parse(readFileSync(`lib/i18n/social-messages/${locale}.json`, "utf8"));
  const t = (source) => {
    assert.ok(messages[source], `${locale}: Missing artwork copy: ${source}`);
    return messages[source];
  };
  const markup = renderToStaticMarkup(
    React.createElement(Artwork, {
      t,
      locale,
      logo: `data:image/png;base64,${readFileSync("public/simplepost-logo.png").toString("base64")}`,
    }),
  );
  writeFileSync(
    path.join(directory, `${locale}.html`),
    `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><meta charset="utf-8"><meta name="viewport" content="width=1200"><title>SimplePost scheduler artwork ${locale}</title><style>*{box-sizing:border-box}html,body{margin:0;width:1200px;height:630px;overflow:hidden}body{position:absolute;left:0;top:0;font-family:Arial,"Noto Sans",sans-serif}</style><body>${markup}</body></html>`,
  );
}
console.warn(
  `Prepared ${locales.length} self-contained 1200×630 browser previews in ${directory}. Capture and review before registering images.`,
);
