import { Args, Command } from "@oclif/core";

import { getAccountPlatformConfig } from "../../lib/account/platforms.js";
import { findStoredAccount, getStoredAccounts, removeStoredAccount } from "../../lib/account/store.js";
import { getCliPaths, loadCliConfig, saveCliConfig } from "../../lib/config.js";
import { createSecretStore } from "../../lib/secrets.js";
import { PromptSession } from "../../lib/ux/prompt.js";

async function chooseAccount(
  prompt: PromptSession,
  config: Awaited<ReturnType<typeof loadCliConfig>>,
): Promise<string | undefined> {
  const accounts = getStoredAccounts(config);
  if (accounts.length === 0) {
    return undefined;
  }

  return prompt.select(
    "Which account should be removed?",
    accounts.map((account) => ({
      label: `${getAccountPlatformConfig(account.platform).displayName}: ${account.alias}${account.username ? ` (@${account.username})` : ""}`,
      value: `${account.platform}:${account.alias}`,
      description: account.displayName || `User ID ${account.userId}`,
    })),
    `${accounts[0].platform}:${accounts[0].alias}`,
  );
}

export default class AccountRemoveCommand extends Command {
  public static override args = {
    account: Args.string({
      description: "Account alias or <platform>:<alias>",
      required: false,
    }),
  };

  public static override description = "Remove a connected account.";

  public async run(): Promise<void> {
    const { args } = await this.parse(AccountRemoveCommand);
    const prompt = new PromptSession();
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);

    const selector = args.account ?? (prompt.interactive ? await chooseAccount(prompt, config) : undefined);
    if (!selector) {
      this.log('No accounts are connected yet. Run "simplepost account add" first.');
      return;
    }

    const account = findStoredAccount(config, selector);

    if (!config.storage) {
      throw new Error('Secret storage is not configured. Run "simplepost setup" first.');
    }

    const store = createSecretStore(paths, config.storage, prompt);
    await store.delete(account.secretRef);
    await saveCliConfig(paths, removeStoredAccount(config, account));
    this.log(`Removed ${getAccountPlatformConfig(account.platform).displayName} account "${account.alias}".`);
  }
}
