import { Command, Flags } from "@oclif/core";

import { getAccountPlatformValues } from "../../lib/account/platforms.js";
import { inboxApi, type InboxRefresh } from "../../lib/scheduler/inbox.js";

export default class InboxRefreshCommand extends Command {
  public static override description = "Advance a bounded inbox refresh for your connected accounts.";

  public static override enableJsonFlag = true;

  public static override flags = {
    platform: Flags.string({ options: getAccountPlatformValues(), description: "Refresh only this platform." }),
    reset: Flags.boolean({ description: "Start again from the newest posts." }),
  };

  public async run(): Promise<InboxRefresh> {
    const { flags } = await this.parse(InboxRefreshCommand);
    const result = await inboxApi<InboxRefresh>(this.config.configDir, "inbox/refresh", "POST", {
      platform: flags.platform,
      reset: flags.reset,
    });
    if (!this.jsonEnabled()) {
      for (const account of result.accounts) {
        this.log(
          `${account.platform} · ${account.error ?? (account.processed ? "Fetched activity" : "No page fetched")}`,
        );
      }
      if (result.hasMore) this.log("Run inbox refresh again to continue.");
    }
    return result;
  }
}
