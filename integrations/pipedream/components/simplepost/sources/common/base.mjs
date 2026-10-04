import simplepost from "../../simplepost.app.mjs";
import utils from "../../common/utils.mjs";

const HISTORICAL_EVENT_LIMIT = 25;

export default {
  props: {
    simplepost,
    db: "$.service.db",
    http: {
      type: "$.interface.http",
      customResponse: true,
    },
  },
  hooks: {
    async deploy() {
      const { posts = [] } = await this.simplepost.listPosts({
        params: {
          type: this.getHistoricalPostType(),
          limit: HISTORICAL_EVENT_LIMIT,
        },
      });
      for (const post of posts.reverse()) {
        this.emitEvent({
          event: this.getEvent(),
          createdAt: post.publishedAt ?? post.updatedAt ?? post.createdAt,
          post: {
            id: post.id,
            status: post.status,
            message: post.message,
            scheduledFor: post.scheduledFor ?? null,
            publishedAt: post.publishedAt ?? null,
            errorMessage: post.errorMessage ?? null,
            accountResults: post.accountResults ?? null,
          },
        });
      }
    },
    async activate() {
      const { webhook } = await this.simplepost.createWebhook({
        data: {
          url: this.http.endpoint,
          events: [
            this.getEvent(),
          ],
        },
      });
      this._setHookId(webhook.id);
      this._setSecret(webhook.secret);
    },
    async deactivate() {
      const hookId = this._getHookId();
      if (hookId) {
        await this.simplepost.deleteWebhook({
          webhookId: hookId,
        });
        this._setHookId(null);
        this._setSecret(null);
      }
    },
  },
  methods: {
    _getHookId() {
      return this.db.get("hookId");
    },
    _setHookId(hookId) {
      this.db.set("hookId", hookId);
    },
    _getSecret() {
      return this.db.get("secret");
    },
    _setSecret(secret) {
      this.db.set("secret", secret);
    },
    getEvent() {
      throw new Error("getEvent is not implemented");
    },
    getHistoricalPostType() {
      throw new Error("getHistoricalPostType is not implemented");
    },
    getSummary() {
      throw new Error("getSummary is not implemented");
    },
    generateMeta(body) {
      const ts = Date.parse(body.createdAt) || Date.now();
      return {
        // A post publishes once, but can fail again after a retry.
        id: `${body.post.id}-${body.event}-${ts}`,
        summary: this.getSummary(body),
        ts,
      };
    },
    emitEvent(body) {
      this.$emit(body, this.generateMeta(body));
    },
  },
  async run(event) {
    const { headers } = event;
    const valid = utils.isValidSignature({
      secret: this._getSecret(),
      timestamp: headers["x-simplepost-timestamp"],
      signature: headers["x-simplepost-signature"],
      rawBody: event.bodyRaw,
    });
    if (!valid) {
      this.http.respond({
        status: 401,
      });
      return;
    }

    this.http.respond({
      status: 200,
    });

    const { body } = event;
    if (body?.event !== this.getEvent() || !body.post?.id) {
      return;
    }
    this.emitEvent(body);
  },
};
