import { Command } from "@oclif/core";

import {
  getAccountPlatformConfig,
  getAccountPlatformValues,
  getClientIdEnvVar,
  hasOAuthAppEnvConfig,
} from "../lib/account/platforms.js";
import { getCliPaths, loadCliConfig } from "../lib/config.js";
import { stdoutColors } from "../lib/ux/colors.js";

export default class StatusCommand extends Command {
  public static override description = "Show the CLI connection and configuration status.";

  public static override examples = ["<%= config.bin %> status"];

  public async run(): Promise<void> {
    const c = stdoutColors;
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);

    const lines: string[] = [c.bold("SimplePost CLI status"), ""];

    if (config.scheduler) {
      const identity = config.scheduler.email || config.scheduler.name || config.scheduler.userId;
      lines.push(
        `${c.lime("●")} SimplePost account: connected as ${c.bold(identity)}`,
        `${c.dim("  URL:")} ${config.scheduler.url}`,
        `${c.dim("  Since:")} ${new Date(config.scheduler.connectedAt).toLocaleString()}`,
      );
    } else {
      lines.push(`${c.dim("○")} SimplePost account: not connected ${c.dim('(run "simplepost connect")')}`);
    }

    lines.push(
      "",
      config.storage
        ? `${c.lime("●")} Secret storage: ${config.storage.backend}`
        : `${c.dim("○")} Secret storage: not configured ${c.dim('(run "simplepost setup")')}`,
      "",
    );

    const localAccounts = getAccountPlatformValues().flatMap((platform) =>
      config[platform].accounts.map((account) => ({ account, platform })),
    );
    if (localAccounts.length > 0) {
      lines.push(`${c.lime("●")} Local accounts (${localAccounts.length}):`);
      for (const { account, platform } of localAccounts) {
        const handle = account.username
          ? ` ${account.username.startsWith("@") ? account.username : `@${account.username}`}`
          : "";
        lines.push(`  ${getAccountPlatformConfig(platform).displayName}: ${account.alias}${c.dim(handle)}`);
      }
    } else {
      lines.push(`${c.dim("○")} Local accounts: none ${c.dim('(run "simplepost account add")')}`);
    }

    const envPlatforms = getAccountPlatformValues().filter((platform) => hasOAuthAppEnvConfig(platform));
    if (envPlatforms.length > 0) {
      lines.push("", `${c.lime("●")} Own OAuth apps configured via environment:`);
      for (const platform of envPlatforms) {
        lines.push(`  ${getAccountPlatformConfig(platform).displayName} ${c.dim(`(${getClientIdEnvVar(platform)})`)}`);
      }
    }

    this.log(lines.join("\n"));
  }
}
