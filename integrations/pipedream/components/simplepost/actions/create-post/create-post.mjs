import { ConfigurationError } from "@pipedream/platform";
import simplepost from "../../simplepost.app.mjs";
import constants from "../../common/constants.mjs";
import utils from "../../common/utils.mjs";

export default {
  key: "simplepost-create-post",
  name: "Create Post",
  description: "Publish a social media post now, schedule it, or save it as a draft across connected accounts. [See the documentation](https://docs.simplepost.social/api-reference)",
  version: "0.0.1",
  type: "action",
  annotations: {
    destructiveHint: false,
    openWorldHint: true,
    readOnlyHint: false,
  },
  props: {
    simplepost,
    accountIds: {
      propDefinition: [
        simplepost,
        "accountIds",
      ],
    },
    postingMode: {
      type: "string",
      label: "Posting Mode",
      description: "When to publish, e.g. `now`. `now` publishes immediately, `schedule` publishes at **Scheduled For**, and `draft` saves without publishing.",
      options: constants.POSTING_MODES,
      default: "now",
    },
    scheduledFor: {
      type: "string",
      label: "Scheduled For",
      description: "Required when **Posting Mode** is `schedule`. An ISO 8601 date and time in the future, e.g. `2030-01-01T09:00:00Z` or `2030-01-01T10:00:00+01:00`. Converted to UTC.",
      optional: true,
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
    imageFit: {
      propDefinition: [
        simplepost,
        "imageFit",
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
    quotePostId: {
      type: "string",
      label: "Quote Post ID",
      description: "The ID of an earlier SimplePost post to quote on platforms that support quote posts, e.g. `cm8x1k2ab0002`. Returned by **Create Post** (the `post.id` field).",
      optional: true,
    },
    repost: {
      type: "boolean",
      label: "Automatically Repost",
      description: "Whether to repost after publishing on platforms that support it (X, Bluesky, Threads, LinkedIn), e.g. `true`. Leave empty to use the account's default repost setting.",
      optional: true,
    },
    repostDelayHours: {
      type: "integer",
      label: "Repost Delay (Hours)",
      description: "Hours between publishing and reposting, from `1` to `720`, e.g. `12`. Used only when **Automatically Repost** is `true`.",
      min: 1,
      max: 720,
      optional: true,
    },
    idempotencyKey: {
      type: "string",
      label: "Idempotency Key",
      description: "A unique key, up to 255 characters, that prevents duplicate posts when a step is retried, e.g. `{{steps.trigger.event.id}}`. A retry with the same key returns the original post instead of publishing again.",
      optional: true,
    },
  },
  async run({ $ }) {
    if (this.postingMode === "schedule" && !this.scheduledFor) {
      throw new ConfigurationError("**Scheduled For** is required when **Posting Mode** is `schedule`.");
    }

    const response = await this.simplepost.createPost({
      $,
      data: {
        message: this.message ?? "",
        accountIds: this.accountIds,
        postingMode: this.postingMode,
        scheduledFor: this.postingMode === "schedule"
          ? utils.toUtcIsoString(this.scheduledFor)
          : undefined,
        media: utils.buildMedia(this.mediaUrls, this.media),
        imageFit: this.imageFit,
        thread: utils.parseJson(this.thread, "Thread (JSON)"),
        accountOptions: utils.parseJson(this.accountOptions, "Account Options (JSON)"),
        accountOverrides: utils.parseJson(this.accountOverrides, "Account Overrides (JSON)"),
        quotePostId: this.quotePostId,
        repost: this.repost === undefined
          ? undefined
          : {
            enabled: this.repost,
            delayHours: this.repostDelayHours,
          },
        idempotencyKey: this.idempotencyKey,
      },
    });

    // A failed publish is returned rather than thrown: some accounts may have
    // succeeded, and a step retry without an idempotency key would repost there.
    const { post } = response;
    const summary = {
      published: `Published post ${post.id}`,
      scheduled: `Scheduled post ${post.id} for ${post.scheduledFor}`,
      draft: `Saved draft ${post.id}`,
      failed: `Post ${post.id} failed to publish: ${post.errorMessage ?? "see postingResults"}`,
    }[post.status] ?? `Created post ${post.id} (${post.status})`;
    $.export("$summary", response.replayed
      ? `${summary} (existing post returned for this idempotency key)`
      : summary);
    return response;
  },
};
