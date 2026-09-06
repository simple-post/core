import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
const [baseUrl, output = ".local/auth/mcp-token.json", storageState] = process.argv.slice(2);
if (!baseUrl)
  throw new Error(
    "Usage: yarn workspace @simple-post/e2e mcp-auth https://your-scheduler.example [.local/auth/mcp-token.json] [scheduler-session.json]",
  );
const origin = new URL(baseUrl);
if (origin.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(origin.hostname))
  throw new Error("Use an HTTPS scheduler origin");
const state = randomBytes(32).toString("hex");
let codeResolve: (code: string) => void = () => {},
  codeReject: (error: Error) => void = () => {};
const code = new Promise<string>((resolve, reject) => {
  codeResolve = resolve;
  codeReject = reject;
});
void code.catch(() => {});
const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/callback" || url.searchParams.get("state") !== state) {
    res.writeHead(400);
    res.end("Invalid authorization state");
    return;
  }
  if (url.searchParams.has("error")) {
    codeReject(new Error("OAuth authorization was declined"));
    res.end("Authorization declined");
    return;
  }
  const value = url.searchParams.get("code");
  if (!value) {
    res.writeHead(400);
    res.end("No authorization code");
    return;
  }
  codeResolve(value);
  res.end("SimplePost test runner authorized. You may close this tab.");
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Missing callback port");
const redirectUrl = `http://127.0.0.1:${address.port}/callback`;
let client: OAuthClientInformationMixed | undefined,
  tokens: OAuthTokens | undefined,
  verifier = "";
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState });
const page = await context.newPage();
const provider: OAuthClientProvider = {
  redirectUrl,
  clientMetadata: {
    client_name: "SimplePost live acceptance tests",
    redirect_uris: [redirectUrl],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  state: () => state,
  clientInformation: () => client,
  saveClientInformation: (value) => {
    client = value;
  },
  tokens: () => tokens,
  saveTokens: async (value) => {
    tokens = value;
    await mkdir(path.dirname(path.resolve(output)), { recursive: true, mode: 0o700 });
    await writeFile(output, JSON.stringify(value, null, 2), { mode: 0o600 });
  },
  redirectToAuthorization: async (url) => {
    await page.goto(url.href);
  },
  saveCodeVerifier: (value) => {
    verifier = value;
  },
  codeVerifier: () => verifier,
};
const timeout = setTimeout(() => codeReject(new Error("OAuth login timed out after ten minutes")), 600_000);
try {
  const result = await auth(provider, { serverUrl: new URL("/mcp", origin) });
  if (result === "REDIRECT")
    await auth(provider, { serverUrl: new URL("/mcp", origin), authorizationCode: await code });
  if (!tokens) throw new Error("Authorization completed without tokens");
  console.log(
    `Saved MCP token to ${output}. This token is private; set mcpTokenFile in your config. No content was posted.`,
  );
} finally {
  clearTimeout(timeout);
  server.closeAllConnections();
  server.close();
  await browser.close();
}
