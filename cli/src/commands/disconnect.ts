import { Command } from "@oclif/core";

import { getCliPaths, loadCliConfig, saveCliConfig, SCHEDULER_SECRET_REF } from "../lib/config.js";
import { createSecretStore } from "../lib/secrets.js";
import { PromptSession } from "../lib/ux/prompt.js";

export default class DisconnectCommand extends Command {
  public static override description = "Disconnect the CLI from SimplePost.";

  public async run(): Promise<void> {
    const prompt = new PromptSession();
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);

    if (!config.scheduler) {
      this.log("The CLI is not connected to a scheduler.");
      return;
    }

    const displayName = config.scheduler.email || config.scheduler.name || config.scheduler.url;

    // Delete the token from the secret store
    if (config.storage) {
      const secretStore = createSecretStore(paths, config.storage, prompt);
      try {
        await secretStore.delete(SCHEDULER_SECRET_REF);
      } catch {
        // Ignore errors when deleting - the secret may not exist
      }
    }

    // Remove scheduler from config
    const { scheduler: _, ...rest } = config;
    await saveCliConfig(paths, rest as typeof config);

    this.log(`Disconnected from SimplePost (${displayName}).`);
  }
}
