import { Command } from "@oclif/core";

import { postFlags } from "../lib/post/flags.js";
import { runPostWorkflow } from "../lib/post/run.js";
import { PromptSession } from "../lib/ux/prompt.js";

export default class PostCommand extends Command {
  public static override description = "Post content to one or more platforms via @simple-post/sdk.";

  public static override flags = postFlags;

  public async run(): Promise<void> {
    const shouldDefaultInteractive = this.argv.length === 0;
    const { flags } = await this.parse(PostCommand);
    await runPostWorkflow({
      config: this.config,
      flags: {
        ...flags,
        interactive: flags.interactive || shouldDefaultInteractive,
      },
      prompt: new PromptSession(),
      writeOutput: (message) => this.log(message),
    });
  }
}
