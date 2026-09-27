import simplepost from '../../simplepost.app.mjs';
import { normalizeScheduledFor } from '../../common.mjs';

const parseOptionalJson = (value, fieldName) => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
};

export default {
  key: 'simplepost-create-post',
  name: 'Create Post',
  description: 'Publishes immediately, schedules, or saves a SimplePost social media post. [See the SimplePost API](https://app.simplepost.social/api/openapi.json)',
  version: '0.1.0',
  type: 'action',
  props: {
    simplepost: {
      type: 'app',
      app: 'simplepost',
    },
    message: {
      type: 'string',
      label: 'Message',
      optional: true,
    },
    accountIds: {
      propDefinition: [simplepost, 'accountIds'],
    },
    postingMode: {
      type: 'string',
      label: 'Posting Mode',
      options: ['now', 'schedule', 'draft'],
      default: 'now',
    },
    scheduledFor: {
      type: 'string',
      label: 'Scheduled For',
      description: 'Required for schedule mode; use an ISO 8601 timestamp.',
      optional: true,
    },
    mediaJson: { type: 'string', label: 'Media (JSON)', optional: true },
    threadJson: { type: 'string', label: 'Thread (JSON)', optional: true },
    accountOptionsJson: { type: 'string', label: 'Account Options (JSON)', optional: true },
    accountOverridesJson: { type: 'string', label: 'Account Overrides (JSON)', optional: true },
    quotePostId: { type: 'string', label: 'Quote Post ID', optional: true },
    repostEnabled: {
      type: 'boolean',
      label: 'Automatically Repost',
      description: 'Whether to automatically repost after publishing.',
      optional: true,
    },
    repostDelayHours: {
      type: 'integer',
      label: 'Repost Delay (Hours)',
      optional: true,
      default: 12,
    },
    idempotencyKey: { type: 'string', label: 'Idempotency Key', optional: true },
  },
  async run({ $ }) {
    const body = {
      message: this.message || '',
      accountIds: this.accountIds,
      postingMode: this.postingMode,
    };
    if (this.postingMode === 'schedule') body.scheduledFor = normalizeScheduledFor(this.scheduledFor);

    const fields = [
      ['media', this.mediaJson, 'Media'],
      ['thread', this.threadJson, 'Thread'],
      ['accountOptions', this.accountOptionsJson, 'Account Options'],
      ['accountOverrides', this.accountOverridesJson, 'Account Overrides'],
    ];
    for (const [key, value, label] of fields) {
      const parsed = parseOptionalJson(value, label);
      if (parsed) body[key] = parsed;
    }
    if (this.quotePostId) body.quotePostId = this.quotePostId;
    if (this.repostEnabled) {
      body.repost = { enabled: true, delayHours: this.repostDelayHours || 12 };
    }
    if (this.idempotencyKey) body.idempotencyKey = this.idempotencyKey;

    const response = await this.simplepost.createPost($, body);
    $.export('$summary', `SimplePost ${response.post.status}: ${response.post.id}`);
    return response;
  },
};
