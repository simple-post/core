import crypto from "node:crypto";
import http from "node:http";

import { Command, Flags } from "@oclif/core";

import { getCliPaths, loadCliConfig, saveCliConfig, SCHEDULER_SECRET_REF } from "../lib/config.js";
import { DEFAULT_CALLBACK_PORT } from "../lib/constants.js";
import { fetchJson } from "../lib/http.js";
import { createSecretStore } from "../lib/secrets.js";
import { configureStorage } from "../lib/setup-storage.js";
import { openExternalUrl } from "../lib/ux/browser.js";
import { PromptSession } from "../lib/ux/prompt.js";

const DEFAULT_SCHEDULER_URL = "https://app.simplepost.social";
const CLI_CALLBACK_PATH = "/cli/callback";
const CALLBACK_TIMEOUT_MS = 90_000;

interface SchedulerUser {
  email?: string;
  id: string;
  name?: string;
}

interface CliTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: "Bearer";
  user: SchedulerUser;
}

export default class ConnectCommand extends Command {
  public static override description = "Connect the CLI to SimplePost to use its connected accounts.";

  public static override examples = [
    "simplepost connect",
    "simplepost connect --url http://localhost:3000",
    "simplepost connect --token sp_cli_...",
  ];

  public static override flags = {
    "callback-port": Flags.integer({
      description: `Loopback callback port (default: ${DEFAULT_CALLBACK_PORT})`,
      env: "SIMPLE_POST_CALLBACK_PORT",
      min: 1,
      max: 65_535,
    }),
    "no-browser": Flags.boolean({
      default: false,
      description: "Do not try to open the browser automatically",
    }),
    token: Flags.string({
      description: "Provide a CLI token directly (for CI/non-interactive use)",
      env: "SIMPLE_POST_CLI_TOKEN",
    }),
    url: Flags.string({
      description: `Scheduler URL (default: ${DEFAULT_SCHEDULER_URL})`,
      env: "SIMPLE_POST_SCHEDULER_URL",
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(ConnectCommand);
    const prompt = new PromptSession();
    const paths = getCliPaths(this.config.configDir);
    let config = await loadCliConfig(paths);

    // Ensure secret storage is configured. Non-interactively this succeeds
    // when SIMPLE_POST_CONFIG_PASSWORD is set (encrypted file backend).
    if (!config.storage) {
      const setupResult = await configureStorage({
        cliConfig: config,
        paths,
        prompt,
      });
      config = setupResult.config;
      await saveCliConfig(paths, config);
      this.log(setupResult.summary);
    }

    const schedulerUrl = (flags.url ?? DEFAULT_SCHEDULER_URL).replace(/\/+$/, "");
    let token: string;
    let user: SchedulerUser | undefined;

    if (flags.token) {
      token = flags.token;
    } else {
      const result = await this.browserFlow(
        schedulerUrl,
        prompt,
        flags["no-browser"],
        flags["callback-port"] ?? DEFAULT_CALLBACK_PORT,
      );
      token = result.token;
      user = result.user;
    }

    // Verify the token works
    await this.verifyToken(schedulerUrl, token);
    if (!user) {
      user = { id: "unknown" };
    }

    // Store the token in the secret store
    const secretStore = createSecretStore(paths, config.storage!, prompt);
    await secretStore.write(SCHEDULER_SECRET_REF, { token });

    // Save scheduler connection info to config
    config = {
      ...config,
      scheduler: {
        url: schedulerUrl,
        userId: user.id,
        ...(user.email ? { email: user.email } : {}),
        ...(user.name ? { name: user.name } : {}),
        connectedAt: new Date().toISOString(),
      },
    };
    await saveCliConfig(paths, config);

    const displayName = user.email || user.name || user.id;
    this.log(`\nConnected to SimplePost as ${displayName}.`);
    this.log(`Scheduler URL: ${schedulerUrl}`);
    this.log('\nRun "simplepost account" to see all your connected accounts.');
  }

  private async browserFlow(
    schedulerUrl: string,
    prompt: PromptSession,
    noBrowser: boolean,
    callbackPort: number,
  ): Promise<{ token: string; user: SchedulerUser }> {
    const state = crypto.randomUUID();
    const redirectUri = `http://127.0.0.1:${callbackPort}${CLI_CALLBACK_PATH}`;
    const authUrl = `${schedulerUrl}/cli/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    prompt.log("");
    prompt.log("Open this URL in your browser to authorize the CLI:");
    prompt.log(authUrl);
    prompt.log("");

    if (noBrowser) {
      prompt.log("Open the URL above in your browser.");
    } else {
      try {
        await openExternalUrl(authUrl);
      } catch {
        prompt.log("Could not open the browser automatically. Open the URL above manually.");
      }
    }

    prompt.log("Waiting for authorization...");

    const callbackUrl = await this.waitForCallback(redirectUri);

    // Parse callback URL
    const parsed = new URL(callbackUrl);

    const error = parsed.searchParams.get("error");
    if (error) {
      const description = parsed.searchParams.get("error_description");
      throw new Error(description ? `Authorization denied: ${description}` : "Authorization denied by user.");
    }

    const returnedState = parsed.searchParams.get("state");
    if (returnedState !== state) {
      throw new Error("State validation failed. Please try again.");
    }

    const code = parsed.searchParams.get("code");
    if (!code) {
      throw new Error("No authorization code received from scheduler. Please try again.");
    }

    const exchanged = await fetchJson<CliTokenResponse>(
      `${schedulerUrl}/api/cli/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, redirect_uri: redirectUri }),
      },
      "CLI token exchange",
    );

    if (!exchanged.access_token || exchanged.token_type !== "Bearer" || !exchanged.user?.id) {
      throw new Error("Scheduler returned an invalid CLI token response.");
    }

    return { token: exchanged.access_token, user: exchanged.user };
  }

  private waitForCallback(redirectUri: string): Promise<string> {
    const parsed = new URL(redirectUri);
    const port = Number(parsed.port);
    const host = parsed.hostname;
    const pathname = parsed.pathname;

    return new Promise((resolve, reject) => {
      let settled = false;

      const server = http.createServer((req, res) => {
        const requestUrl = new URL(req.url ?? "/", `http://${host}:${port}`);

        if (requestUrl.pathname !== pathname) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Not found.");
          return;
        }

        res.statusCode = 200;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.end(
          "<html><body><h1>SimplePost CLI connected.</h1><p>You can close this browser tab and return to the terminal.</p></body></html>",
        );

        if (!settled) {
          settled = true;
          clearTimeout(timer);
          server.close(() => {});
          resolve(requestUrl.toString());
        }
      });

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          server.close(() => {});
          reject(new Error("Authorization timed out. Please try again."));
        }
      }, CALLBACK_TIMEOUT_MS);

      server.once("error", (error: NodeJS.ErrnoException) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        server.close(() => {});
        if (error.code === "EADDRINUSE") {
          reject(new Error(`Port ${port} is already in use. Free that port and try again.`));
        } else {
          reject(new Error(`Failed to start callback server: ${error.message}`));
        }
      });

      server.listen(port, host, () => {});
    });
  }

  private async verifyToken(schedulerUrl: string, token: string): Promise<void> {
    try {
      await fetchJson(
        `${schedulerUrl}/api/v1/accounts`,
        {
          headers: { Authorization: `Bearer ${token}` },
          method: "GET",
        },
        "Scheduler connection verification",
      );
    } catch (error) {
      throw new Error(
        `Failed to verify connection to scheduler at ${schedulerUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
