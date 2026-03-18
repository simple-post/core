#!/usr/bin/env node

import { execute } from "@oclif/core";

const argv = process.argv.slice(2);
const topLevelCommands = new Set(["account", "help", "post", "setup"]);
const rootFlags = new Set(["-h", "--help", "-v", "--version"]);
const shouldRewriteLegacyPost =
  argv.length > 0 &&
  argv[0].startsWith("-") &&
  !rootFlags.has(argv[0]) &&
  !argv.some((token) => topLevelCommands.has(token));

if (shouldRewriteLegacyPost) {
  process.stderr.write('Warning: compatibility mode enabled. Prefer "simple-post post ...".\n');
  argv.unshift("post");
}

await execute({ args: argv, dir: import.meta.url });
