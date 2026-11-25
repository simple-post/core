import { Args, Command } from "@oclif/core";

import { inboxApi, type InboxReceipt } from "../../lib/scheduler/inbox.js";

export default class InboxLikeCommand extends Command {
  public static override description = "Like the selected inbox item as its receiving account.";

  public static override enableJsonFlag = true;

  public static override args = {
    item: Args.string({ required: true, description: "Inbox item ID." }),
  };

  public async run(): Promise<InboxReceipt> {
    const { args } = await this.parse(InboxLikeCommand);
    const result = await inboxApi<InboxReceipt>(
      this.config.configDir,
      `items/${encodeURIComponent(args.item)}/like`,
      "PUT",
    );
    if (!this.jsonEnabled()) this.log(result.status === "sent" ? "Liked" : (result.errorMessage ?? result.status));
    if (result.status !== "sent") process.exitCode = 1;
    return result;
  }
}
