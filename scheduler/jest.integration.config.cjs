/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- Jest configuration is CommonJS. */
const config = require("./jest.config.cjs");
const url = process.env.INTEGRATION_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !new URL(url).pathname.endsWith("simplepost_review")
) {
  throw new Error(
    "Integration tests require a disposable localhost database named simplepost_review via INTEGRATION_DATABASE_URL",
  );
}
process.env.DATABASE_URL = url;
module.exports = {
  ...config,
  roots: ["<rootDir>/integration"],
  testMatch: ["<rootDir>/integration/**/*.test.ts"],
  testTimeout: 20_000,
};
