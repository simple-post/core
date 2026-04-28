import { Args, Command, Flags } from "@oclif/core";

import { getAuthProvider } from "../../lib/auth/registry.js";
import { getCliPaths, loadCliConfig, saveCliConfig } from "../../lib/config.js";
import { getAccountPlatformOptions, getAccountPlatformValues, type AccountPlatform } from "../../lib/account/platforms.js";
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
  };

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(AccountAddCommand);
    const prompt = new PromptSession();
    const platform = (args.platform as AccountPlatform | undefined) ?? (prompt.interactive ? await choosePlatform(prompt) : undefined);

    if (!platform) {
      throw new Error('Platform is required in non-interactive mode. Run "simplepost account add <platform>".');
    }

    const paths = getCliPaths(this.config.configDir);
    let config = await loadCliConfig(paths);

    if (!config.storage) {
      if (!prompt.interactive) {
        throw new Error('Secret storage is not configured. Run "simplepost setup --backend <backend>" first.');
      }

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
      callbackUrl: flags["callback-url"],
      chatId: flags["chat-id"],
      noBrowser: flags["no-browser"],
      redirectUri: flags["redirect-uri"],
    };
    const nextConfig = await provider.login(
      loginFlags,
      {
        config,
        paths,
        prompt,
        secretStore: createSecretStore(paths, config.storage!, prompt),
      },
    );

    await saveCliConfig(paths, nextConfig);
  }
}
