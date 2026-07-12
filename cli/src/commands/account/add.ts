import { Args, Command, Flags } from "@oclif/core";

import {
  getAccountPlatformOptions,
  getAccountPlatformValues,
  type AccountPlatform,
} from "../../lib/account/platforms.js";
import { getAuthProvider } from "../../lib/auth/registry.js";
import { getCliPaths, loadCliConfig, saveCliConfig } from "../../lib/config.js";
import { DEFAULT_CALLBACK_PORT } from "../../lib/constants.js";
import { createSecretStore } from "../../lib/secrets.js";
import { configureStorage } from "../../lib/setup-storage.js";
import { PromptSession } from "../../lib/ux/prompt.js";

async function choosePlatform(prompt: PromptSession): Promise<AccountPlatform> {
  return prompt.select("Which platform do you want to connect?", getAccountPlatformOptions(), "x");
}

export default class AccountAddCommand extends Command {
  public static override args = {
    platform: Args.string({
      description: "Platform to connect",
      options: getAccountPlatformValues(),
      required: false,
    }),
  };

  public static override description = "Connect a new account.";

  public static override flags = {
    alias: Flags.string({
      description: "Alias to store for the connected account",
    }),
    "bot-token": Flags.string({
      description: "Telegram bot token (for non-interactive Telegram connect)",
    }),
    "callback-url": Flags.string({
      description: "Provide the final browser callback URL directly instead of waiting for the listener",
    }),
    "callback-port": Flags.integer({
      description: `Loopback callback port when no platform redirect URI override is set (default: ${DEFAULT_CALLBACK_PORT})`,
      env: "SIMPLE_POST_CALLBACK_PORT",
      min: 1,
      max: 65_535,
    }),
    "chat-id": Flags.string({
      description: "Telegram chat ID (for non-interactive Telegram connect)",
    }),
    "no-browser": Flags.boolean({
      default: false,
      description: "Do not try to open the browser automatically",
    }),
    "redirect-uri": Flags.string({
      description: "Loopback redirect URI to use for the OAuth callback",
    }),
    "instance-url": Flags.string({ description: "Lemmy instance URL" }),
    username: Flags.string({ description: "Lemmy username" }),
    password: Flags.string({ description: "Lemmy password (prefer interactive entry)" }),
    "community-id": Flags.integer({ description: "Default Lemmy community ID" }),
    "api-version": Flags.string({ description: "Lemmy API version (v3 or v4)" }),
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(AccountAddCommand);
    const prompt = new PromptSession();
    const platform =
      (args.platform as AccountPlatform | undefined) ?? (prompt.interactive ? await choosePlatform(prompt) : undefined);

    if (!platform) {
      throw new Error('Platform is required in non-interactive mode. Run "simplepost account add <platform>".');
    }

    const paths = getCliPaths(this.config.configDir);
    let config = await loadCliConfig(paths);

    // Non-interactively this succeeds when SIMPLE_POST_CONFIG_PASSWORD is set.
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

    const provider = getAuthProvider(platform);
    const loginFlags = {
      alias: flags.alias,
      botToken: flags["bot-token"],
      callbackPort: flags["callback-port"],
      callbackUrl: flags["callback-url"],
      chatId: flags["chat-id"],
      noBrowser: flags["no-browser"],
      redirectUri: flags["redirect-uri"],
      instanceUrl: flags["instance-url"],
      username: flags.username,
      password: flags.password,
      communityId: flags["community-id"],
      apiVersion: flags["api-version"],
    };
    const nextConfig = await provider.login(loginFlags, {
      config,
      paths,
      prompt,
      secretStore: createSecretStore(paths, config.storage!, prompt),
    });

    await saveCliConfig(paths, nextConfig);
  }
}
