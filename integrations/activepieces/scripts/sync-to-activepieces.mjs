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
const alternateType = options.type === 'community' ? 'custom' : 'community';
const alternateTarget = `packages/pieces/${alternateType}/${PIECE_NAME}`;
if (existsSync(path.join(options.activepiecesDir, alternateTarget))) {
  throw new Error(`A SimplePost piece already exists in ${alternateTarget}. Use a separate checkout for the ${options.type} build.`);
}

const tsconfigText = readFileSync(tsconfigPath, 'utf8');
const paths = JSON.parse(tsconfigText).compilerOptions.paths;
const entryPath = `${relativeTarget}/src/index.ts`;
const sourcePackage = JSON.parse(readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));
const packageName = options.packageName ?? sourcePackage.name;
const previousName = Object.keys(paths).find((name) => paths[name].includes(entryPath));
if (paths[packageName] && packageName !== previousName) {
  throw new Error(`The Activepieces checkout already uses the package name ${packageName}.`);
}
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
  writeFileSync(indexPath, source.replace(/logoUrl: '[^']*'/, () => `logoUrl: ${JSON.stringify(options.logoUrl)}`));
}

// Keep the upstream formatting intact, including unrelated workspace paths.
const key = JSON.stringify(packageName);
const nextConfig = previousName
  ? tsconfigText.replace(`${JSON.stringify(previousName)}:`, () => `${key}:`)
  : tsconfigText.replace(/("paths":\s*\{)/, (match) =>
      `${match}\n      ${key}: [\n        ${JSON.stringify(entryPath)}\n      ],`);
if (!JSON.parse(nextConfig).compilerOptions.paths[packageName]?.includes(entryPath)) {
  throw new Error(`Could not register ${packageName} in tsconfig.base.json.`);
}
writeFileSync(tsconfigPath, nextConfig);

console.log(`Copied the piece to ${relativeTarget} as ${packageJson.name}.`);
console.log('Next, from the Activepieces checkout:');
console.log('  bun install');
console.log(`  npx turbo run build lint test --filter=${packageJson.name}`);
console.log(`  npm run build-piece ${PIECE_NAME}`);
