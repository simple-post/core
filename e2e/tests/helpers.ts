import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { configSchema, type LiveConfig, type Account } from "../src/config.js";
import path from "node:path";
export function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "account-1",
    platformAccountId: "platform-user",
    username: "testuser",
    capabilities: [],
    resources: {
      boardId: "board-1",
      boardName: "Test Board",
      playlistId: "playlist-1",
      replyToId: "reply-1",
      organizationId: 123,
      thumbnailUrl: "https://media.example.com/image.jpg",
    },
    observer: { profileUrl: "https://x.com/testuser", open: [], fields: {} },
    ...overrides,
  };
}
export function config(overrides: Partial<LiveConfig> = {}): LiveConfig {
  return configSchema.parse({
    baseUrl: "http://127.0.0.1:3000",
    userId: "user-1",
    mediaBaseUrl: "https://media.example.com/",
    deploymentRevision: "test-build",
    fixtureDir: path.resolve("fixtures/generated"),
    cliEntry: path.resolve("../cli/bin/run.js"),
    accounts: { x: account() },
    ...overrides,
  });
}
export async function serve(
  handler: (req: IncomingMessage, res: ServerResponse, body: unknown) => void | Promise<void>,
) {
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks).toString();
      let body: unknown;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        body = raw;
      }
      await handler(req, res, body);
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((e) => (e ? reject(e) : resolve()));
        server.closeAllConnections();
      }),
  };
}
export function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}
