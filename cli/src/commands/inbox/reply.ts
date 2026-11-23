import { Args, Command, Flags } from "@oclif/core";

import { inboxApi, type InboxReceipt } from "../../lib/scheduler/inbox.js";

export default class InboxReplyCommand extends Command {
  public static override description = "Publish a reply to the selected inbox item.";

  public static override enableJsonFlag = true;

  public static override args = {
    item: Args.string({ required: true, description: "Inbox item ID." }),
  };

  public static override flags = {
    text: Flags.string({ required: true, description: "Reply text." }),
    "idempotency-key": Flags.string({
      required: true,
      description: "Unique key for this reply. Reuse it after an interruption.",
    }),
  };

  public async run(): Promise<InboxReceipt> {
    const { args, flags } = await this.parse(InboxReplyCommand);
    const result = await inboxApi<InboxReceipt>(
      this.config.configDir,
      `items/${encodeURIComponent(args.item)}/reply`,
      "POST",
      {
        body: flags.text,
        idempotencyKey: flags["idempotency-key"],
      },
    );
    if (!this.jsonEnabled()) this.log(result.nativeReplyUrl ?? result.errorMessage ?? result.status);
    if (result.status !== "sent") process.exitCode = 1;
    return result;
  }
}
