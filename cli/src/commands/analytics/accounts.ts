import { Command, Flags } from "@oclif/core";
import { getAccountAnalytics, type Platform } from "@simple-post/sdk";

import { jsonFlag, refreshFlag } from "../../lib/analytics/flags.js";
import { persistRefreshedSecrets } from "../../lib/analytics/local.js";
import {
  formatNumber,
  platformLabel,
  renderAccounts,
  type AccountAnalyticsResponse,
} from "../../lib/analytics/render.js";
import { getCliPaths, loadCliConfig } from "../../lib/config.js";
import { CredentialResolver, parseAccountSelections } from "../../lib/credentials.js";
import { fetchSchedulerApi, getSchedulerContextFromConfig } from "../../lib/scheduler/client.js";
import { createSecretStore } from "../../lib/secrets.js";
import { stdoutColors } from "../../lib/ux/colors.js";
import { PromptSession } from "../../lib/ux/prompt.js";

export default class AnalyticsAccountsCommand extends Command {
  public static override description = "Show followers and other account analytics for your connected accounts.";

  public static override examples = [
    "<%= config.bin %> analytics accounts",
    "<%= config.bin %> analytics accounts --refresh force",
    "<%= config.bin %> analytics accounts --account x:main --account bluesky:me",
  ];

  public static override flags = {
    account: Flags.string({
      multiple: true,
      description: "Read a local account <platform>:<alias> directly instead of your SimplePost account.",
      helpGroup: "Local",
    }),
    refresh: refreshFlag,
    json: jsonFlag,
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(AnalyticsAccountsCommand);
    const paths = getCliPaths(this.config.configDir);
    const config = await loadCliConfig(paths);
    const prompt = new PromptSession();

    if (!flags.account?.length) {
      const ctx = await getSchedulerContextFromConfig(config, paths, prompt);
      const response = await fetchSchedulerApi<AccountAnalyticsResponse>(
        ctx,
        `/api/v1/analytics/accounts?refresh=${flags.refresh}`,
      );
      this.log(flags.json ? JSON.stringify(response, null, 2) : renderAccounts(response, stdoutColors));
      return;
    }

    if (!config.storage) throw new Error('Stored accounts are not configured yet. Run "simplepost setup" first.');
    const store = createSecretStore(paths, config.storage, prompt);
    const resolver = new CredentialResolver(config, store);
    const rows: Array<Record<string, unknown>> = [];
    const lines: string[] = [];
    for (const [platform, aliases] of Object.entries(parseAccountSelections(flags.account)) as Array<
      [Platform, string[]]
    >) {
      for (const alias of aliases) {
        const resolved = await resolver.resolveAccount(platform, alias);
        const result = await getAccountAnalytics({ platform, options: resolved.postOptions });
        await persistRefreshedSecrets(store, resolved.secretRef, result.refreshedCredentials);
        const { refreshedCredentials: _ignored, ...publicResult } = result;
        rows.push({ alias, ...publicResult });
        const metrics = Object.entries(result.metrics)
          .map(([name, value]) => `${name} ${formatNumber(value)}`)
          .join(" · ");
        lines.push(
          `${platformLabel(platform)} · ${alias}: ${result.status === "ok" ? metrics || "no metrics reported" : result.status}${
            result.message ? stdoutColors.dim(` — ${result.message}`) : ""
          }`,
        );
      }
    }
    this.log(flags.json ? JSON.stringify(rows, null, 2) : lines.join("\n"));
    if (rows.some((row) => row.status !== "ok")) process.exitCode = 1;
  }
}
