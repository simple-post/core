import { pathToFileURL } from "node:url";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { LiveConfig } from "./config.js";

// Reuse the CLI's normal secret-store reader (keychain/encrypted/plain), without copying tokens
// into the test manifest or printing them. Only the scheduler connection token is requested.
export async function cliSession(config: Pick<LiveConfig, "cliEntry" | "cliConfigDir" | "baseUrl">) {
  if (!config.cliConfigDir) throw new Error("No CLI configuration directory selected");
  const root = path.resolve(path.dirname(config.cliEntry), "../dist/lib");
  const { getSchedulerContext } = await import(pathToFileURL(path.join(root, "scheduler/client.js")).href);
  const { PromptSession } = await import(pathToFileURL(path.join(root, "ux/prompt.js")).href);
  const input = new PassThrough(),
    output = new PassThrough();
  try {
    const session = (await getSchedulerContext(config.cliConfigDir, new PromptSession({ input, output }))) as {
      schedulerUrl: string;
      token: string;
    };
    if (new URL(session.schedulerUrl).origin !== config.baseUrl)
      throw new Error("Selected CLI connection targets a different deployment");
    return session;
  } finally {
    input.destroy();
    output.destroy();
  }
}
