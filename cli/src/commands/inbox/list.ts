import { Command, Flags } from "@oclif/core";

import { getAccountPlatformValues } from "../../lib/account/platforms.js";
import { inboxApi, type InboxPage } from "../../lib/scheduler/inbox.js";

function terminalText(text: string): string {
  return text.replaceAll(/\p{Cc}/gu, " ");
}

export default class InboxListCommand extends Command {
  public static override description = "List replies, comments, and quote posts in your SimplePost inbox.";

  public static override enableJsonFlag = true;

  public static override flags = {
    platform: Flags.string({ options: getAccountPlatformValues(), description: "Filter by platform." }),
    kind: Flags.string({ options: ["comment", "reply", "quote"], description: "Filter by activity type." }),
    "needs-reply": Flags.boolean({ description: "Show items awaiting a reply." }),
    cursor: Flags.string({ description: "Continue from a previous page." }),
    limit: Flags.integer({ min: 1, max: 100, description: "Maximum number of items." }),
  };

  public async run(): Promise<InboxPage> {
    const { flags } = await this.parse(InboxListCommand);
    const query = new URLSearchParams();
    if (flags.platform) query.set("platform", flags.platform);
    if (flags.kind) query.set("kind", flags.kind);
    if (flags["needs-reply"]) query.set("needsReply", "true");
    if (flags.cursor) query.set("cursor", flags.cursor);
    if (flags.limit) query.set("limit", String(flags.limit));
    const result = await inboxApi<InboxPage>(this.config.configDir, `inbox?${query}`);
    if (!this.jsonEnabled()) {
      if (result.items.length === 0)
        this.log("No activity matches these filters. Use inbox refresh to check for new items.");
      for (const item of result.items) {
        this.log(
          `${item.id} · ${item.platform} ${item.kind} · ${terminalText(item.author?.name ?? item.author?.username ?? "Unknown author")} → ${terminalText(item.accountName)}`,
        );
        this.log(`  ${terminalText(item.body)}`);
      }
      if (result.nextCursor) this.log(`Next page: --cursor ${result.nextCursor}`);
    }
    return result;
  }
}
