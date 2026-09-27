import simplepost from '../../simplepost.app.mjs';

const parseOptionalJson = (value, fieldName) => {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${fieldName} must be valid JSON.`);
  }
};

export default {
  key: 'simplepost-validate-post',
  name: 'Validate Post',
  description: 'Validates a SimplePost social media post without creating it. [See the SimplePost API](https://app.simplepost.social/api/openapi.json)',
  version: '0.1.0',
  type: 'action',
  props: {
    simplepost: { type: 'app', app: 'simplepost' },
    message: { type: 'string', label: 'Message', optional: true },
    accountIds: { propDefinition: [simplepost, 'accountIds'] },
    mediaJson: { type: 'string', label: 'Media (JSON)', optional: true },
    threadJson: { type: 'string', label: 'Thread (JSON)', optional: true },
    accountOverridesJson: { type: 'string', label: 'Account Overrides (JSON)', optional: true },
  },
  async run({ $ }) {
    const body = { message: this.message || '', accountIds: this.accountIds };
    for (const [key, value, label] of [
      ['media', this.mediaJson, 'Media'],
      ['thread', this.threadJson, 'Thread'],
      ['accountOverrides', this.accountOverridesJson, 'Account Overrides'],
    ]) {
      const parsed = parseOptionalJson(value, label);
      if (parsed) body[key] = parsed;
    }
    const response = await this.simplepost.validatePost($, body);
    $.export('$summary', response.summary.isValid ? 'Post is valid' : 'Post has validation errors');
    return response;
  },
};
