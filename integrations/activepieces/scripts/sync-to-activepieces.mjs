#!/usr/bin/env node
// Copies the SimplePost piece into an Activepieces monorepo checkout as
// packages/pieces/<type>/simplepost and registers it in tsconfig.base.json.
//
// Usage:
//   node integrations/activepieces/scripts/sync-to-activepieces.mjs <activepieces-dir>
//     [--type community|custom]        target folder (default: community)
//     [--package-name <npm name>]      e.g. @simple-post/piece-simplepost for npm publishing
//     [--logo-url <url>]               logo to use instead of the Activepieces CDN path
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PIECE_NAME = 'simplepost';
const UPSTREAM_PACKAGE = '@activepieces/piece-simplepost';
const sourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../piece');

function parseArgs(argv) {
  const options = { type: 'community' };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--type') options.type = argv[++index];
    else if (arg === '--package-name') options.packageName = argv[++index];
    else if (arg === '--logo-url') options.logoUrl = argv[++index];
    else positional.push(arg);
  }
  if (positional.length !== 1 || !['community', 'custom'].includes(options.type)) {
    console.error(
      'Usage: sync-to-activepieces.mjs <activepieces-dir> [--type community|custom] [--package-name <name>] [--logo-url <url>]',
    );
    process.exit(1);
  }
  return { ...options, activepiecesDir: path.resolve(positional[0]) };
}

const options = parseArgs(process.argv.slice(2));
const tsconfigPath = path.join(options.activepiecesDir, 'tsconfig.base.json');
if (!existsSync(tsconfigPath) || !existsSync(path.join(options.activepiecesDir, 'packages/pieces/framework'))) {
  console.error(`${options.activepiecesDir} does not look like an Activepieces checkout.`);
  process.exit(1);
}

const relativeTarget = `packages/pieces/${options.type}/${PIECE_NAME}`;
const targetDir = path.join(options.activepiecesDir, relativeTarget);
rmSync(targetDir, { recursive: true, force: true });
cpSync(sourceDir, targetDir, {
  recursive: true,
  filter: (source) => !/(^|\/)(node_modules|dist)(\/|$)/.test(path.relative(sourceDir, source)),
});

const packageJsonPath = path.join(targetDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
if (options.packageName) {
  packageJson.name = options.packageName;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

if (options.logoUrl) {
  const indexPath = path.join(targetDir, 'src/index.ts');
  const source = readFileSync(indexPath, 'utf8');
  writeFileSync(indexPath, source.replace(/logoUrl: '[^']*'/, `logoUrl: '${options.logoUrl}'`));
}

// The monorepo resolves pieces through tsconfig paths. Edit the file as text so
// the diff is only our entry, inserted alphabetically among the piece entries.
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
let tsconfigText = readFileSync(tsconfigPath, 'utf8');
for (const name of new Set([UPSTREAM_PACKAGE, packageJson.name])) {
  tsconfigText = tsconfigText.replace(new RegExp(`\\n {6}"${escape(name)}": \\[\\n[^\\]]*\\],`, 'g'), '');
}
const entry = `      "${packageJson.name}": [\n        "${relativeTarget}/src/index.ts"\n      ],\n`;
const pieceKeys = [...tsconfigText.matchAll(/^ {6}"(@activepieces\/piece-[^"]+)": \[$/gm)];
const next = packageJson.name.startsWith('@activepieces/piece-')
  ? pieceKeys.find((match) => match[1].localeCompare(packageJson.name) > 0)
  : undefined;
if (next) {
  tsconfigText = `${tsconfigText.slice(0, next.index)}${entry}${tsconfigText.slice(next.index)}`;
} else {
  tsconfigText = tsconfigText.replace(/("paths": \{\n)/, `$1${entry}`);
}
JSON.parse(tsconfigText);
writeFileSync(tsconfigPath, tsconfigText);

console.log(`Copied the piece to ${relativeTarget} as ${packageJson.name}.`);
console.log('Next, from the Activepieces checkout:');
console.log('  bun install');
console.log(`  npx turbo run build lint test --filter=${packageJson.name}`);
console.log(`  npm run build-piece ${PIECE_NAME}`);
