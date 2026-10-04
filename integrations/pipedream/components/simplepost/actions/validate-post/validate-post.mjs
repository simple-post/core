import simplepost from "../../simplepost.app.mjs";
import utils from "../../common/utils.mjs";

export default {
  key: "simplepost-validate-post",
  name: "Validate Post",
  description: "Check a post against each selected account's platform rules (length, media, threads) without saving or publishing it. [See the documentation](https://docs.simplepost.social/api-reference)",
  version: "0.0.1",
  type: "action",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: true,
  },
  props: {
    simplepost,
    accountIds: {
      propDefinition: [
        simplepost,
        "accountIds",
      ],
    },
    message: {
      propDefinition: [
        simplepost,
        "message",
      ],
    },
    mediaUrls: {
      propDefinition: [
        simplepost,
        "mediaUrls",
      ],
    },
    media: {
      propDefinition: [
        simplepost,
        "media",
      ],
    },
    thread: {
      propDefinition: [
        simplepost,
        "thread",
      ],
    },
    accountOptions: {
      propDefinition: [
        simplepost,
        "accountOptions",
      ],
    },
    accountOverrides: {
      propDefinition: [
        simplepost,
        "accountOverrides",
      ],
    },
  },
  async run({ $ }) {
    const response = await this.simplepost.validatePost({
      $,
      data: {
        message: this.message ?? "",
        accountIds: this.accountIds,
        media: utils.buildMedia(this.mediaUrls, this.media),
        thread: utils.parseJson(this.thread, "Thread (JSON)"),
        accountOptions: utils.parseJson(this.accountOptions, "Account Options (JSON)"),
        accountOverrides: utils.parseJson(this.accountOverrides, "Account Overrides (JSON)"),
      },
    });

    const {
      isValid, errors = [], warnings = [],
    } = response.summary;
    $.export("$summary", isValid
      ? `Post is valid for ${this.accountIds.length} account(s)${warnings.length
        ? ` with ${warnings.length} warning(s)`
        : ""}`
      : `Post has ${errors.length} validation error(s): ${errors.map((error) => error.message).join("; ")}`);
    return response;
  },
};
