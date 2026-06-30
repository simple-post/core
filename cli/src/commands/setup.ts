import { Command, Flags } from "@oclif/core";

import { getCliPaths, loadCliConfig, saveCliConfig } from "../lib/config.js";
import { configureStorage } from "../lib/setup-storage.js";
import { PromptSession } from "../lib/ux/prompt.js";

import type { SecretBackend } from "../lib/types.js";

export default class SetupCommand extends Command {
  public static override description = "Configure how the CLI stores local credentials and secrets.";

  public static override flags = {
    backend: Flags.string({
      description: "Secret storage backend",
      options: ["keychain", "file-plain", "file-encrypted"],
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(SetupCommand);
    const prompt = new PromptSession();
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);
    const result = await configureStorage({
      backend: flags.backend as SecretBackend | undefined,
      cliConfig: config,
      paths,
      prompt,
    });

    await saveCliConfig(paths, result.config);
    this.log(result.summary);
  }
}
