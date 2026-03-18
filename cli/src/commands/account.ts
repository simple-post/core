import { Args, Command } from "@oclif/core";

import { getCliPaths, loadCliConfig } from "../lib/config.js";
import { getAccountPlatformValues } from "../lib/account/platforms.js";
import { parseAccountPlatform, getStoredAccounts, renderStoredAccounts } from "../lib/account/store.js";
import { getAccountPlatformConfig } from "../lib/account/platforms.js";

export default class AccountCommand extends Command {
  public static override args = {
    platform: Args.string({
      description: "Optional platform filter, for example x",
      options: getAccountPlatformValues(),
      required: false,
    }),
  };

  public static override description = "List connected accounts.";

  public static override examples = [
    "<%= config.bin %> account",
    "<%= config.bin %> account x",
    "<%= config.bin %> account add x",
    "<%= config.bin %> account remove main",
  ];

  public async run(): Promise<void> {
    const { args } = await this.parse(AccountCommand);
    const platform = parseAccountPlatform(args.platform);
    const config = await loadCliConfig(getCliPaths(this.config.configDir));
    const accounts = getStoredAccounts(config, platform);

    if (accounts.length === 0) {
      if (platform) {
        this.log(`No ${getAccountPlatformConfig(platform).displayName} accounts are connected yet. Run "simple-post account add ${platform}" first.`);
      } else {
        this.log('No accounts are connected yet. Run "simple-post account add" first.');
      }

      return;
    }

    this.log(renderStoredAccounts(accounts, { includePlatform: !platform }));
  }
}
