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

    // Revoke the remote token before removing the local copy. Failure to reach
    // the Scheduler is reported, but local disconnect still completes.
    if (config.storage) {
      const secretStore = createSecretStore(paths, config.storage, prompt);
      try {
        const secret = await secretStore.read(SCHEDULER_SECRET_REF);
        if (secret && typeof secret.token === "string") {
          const response = await fetch(`${config.scheduler.url}/api/cli/token`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${secret.token}` },
          });
          if (!response.ok && response.status !== 401) {
            this.warn(`Could not revoke the remote CLI token (HTTP ${response.status}).`);
          }
        }
      } catch (error) {
        this.warn(`Could not revoke the remote CLI token: ${error instanceof Error ? error.message : String(error)}`);
      }

      try {
        await secretStore.delete(SCHEDULER_SECRET_REF);
      } catch (error) {
        this.warn(`Could not remove the local CLI token: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Remove scheduler from config
    const { scheduler: _, ...rest } = config;
    await saveCliConfig(paths, rest as typeof config);

    this.log(`Disconnected from SimplePost (${displayName}).`);
  }
}
