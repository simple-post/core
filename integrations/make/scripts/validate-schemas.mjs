// Validates the app source against the JSON schemas that the official Make Apps
// Editor (integromat/vscode-apps-sdk) applies to local-development projects.
// The schemas are downloaded from a pinned commit and cached locally.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv from "ajv";
import addFormats from "ajv-formats";

const SDK_COMMIT = "94a0cd0906d86e0b4aaabe3ae0bb99c9ef6d86c9";
const SDK_RAW = `https://raw.githubusercontent.com/integromat/vscode-apps-sdk/${SDK_COMMIT}`;
const IML_SCHEMAS = [
  "api-oauth.json",
  "api.json",
  "base.json",
  "common.json",
  "endpoint-api.json",
  "enums.json",
  "epoch.json",
  "groups.json",
  "parameters.json",
  "response.json",
  "samples.json",
  "scope.json",
  "scopes.json",
  "sources.json",
];
const MAKECOMAPP_SCHEMA = "makecomapp.schema.json";

// Mirrors `contributes.jsonValidation` in the extension's package.json.
const FILE_SCHEMAS = [
  [/\.(params|mappable-params|static-params|interface)\.iml\.json$/, "parameters.json"],
  [/\.(communication|attach|detach)\.iml\.json$/, "api.json"],
  [/\.samples\.iml\.json$/, "samples.json"],
  [/(^|\/)base\.iml\.json$/, "base.json"],
  [/(^|\/)common\.json$/, "common.json"],
  [/(^|\/)groups\.json$/, "groups.json"],
  [/(^|\/)makecomapp\.json$/, MAKECOMAPP_SCHEMA],
];

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(projectDir, "src");
const cacheDir = path.join(projectDir, "node_modules", ".cache", `make-schemas-${SDK_COMMIT.slice(0, 12)}`);

async function loadSchema(name) {
  const cached = path.join(cacheDir, name);
  try {
    return JSON.parse(await fs.readFile(cached, "utf8"));
  } catch {
    const dir = name === MAKECOMAPP_SCHEMA ? "syntaxes/local-development/schemas" : "syntaxes/imljson/schemas";
    const response = await fetch(`${SDK_RAW}/${dir}/${name}`);
    if (!response.ok) throw new Error(`Failed to download ${name}: HTTP ${response.status}`);
    const text = await response.text();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cached, text);
    return JSON.parse(text);
  }
}

async function listFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? listFiles(full) : [full];
    }),
  );
  return files.flat();
}

// The upstream schemas use regex escapes that are invalid in unicode mode.
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false, unicodeRegExp: false });
addFormats(ajv);
for (const name of [...IML_SCHEMAS, MAKECOMAPP_SCHEMA]) {
  const schema = await loadSchema(name);
  delete schema.$id;
  ajv.addSchema(schema, name);
}

let failures = 0;
let checked = 0;
for (const file of (await listFiles(srcDir)).sort()) {
  const relative = path.relative(srcDir, file);
  const match = FILE_SCHEMAS.find(([pattern]) => pattern.test(relative));
  if (!match) continue;
  const validate = ajv.getSchema(match[1]);
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  checked += 1;
  if (!validate(data)) {
    failures += 1;
    console.error(`✗ ${relative} (${match[1]})`);
    for (const error of validate.errors) {
      console.error(`    ${error.instancePath || "/"} ${error.message} ${JSON.stringify(error.params)}`);
    }
  }
}

console.log(`Validated ${checked} files against Make Apps Editor schemas @ ${SDK_COMMIT.slice(0, 12)}.`);
if (failures > 0) {
  console.error(`${failures} file(s) failed validation.`);
  process.exit(1);
}
