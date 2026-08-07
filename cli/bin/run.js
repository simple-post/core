#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { execute } from "@oclif/core";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

if (["-v", "--version"].includes(process.argv[2])) {
  process.stdout.write(`${version}\n`);
} else {
  await execute({ dir: import.meta.url });
}
