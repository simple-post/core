const { createPostPayload, listAccounts, request } = require('./lib/simplepost');

const authentication = {
  type: 'custom',
  test: async (z, bundle) => request(z, bundle, { method: 'GET', path: '/api/v1/accounts' }),
  fields: [
    {
      key: 'apiKey',
      label: 'API Key',
      type: 'password',
      required: true,
      helpText: 'Create an API key in SimplePost under API Keys.',
    },
    {
      key: 'baseUrl',
      label: 'Base URL',
      type: 'string',
      required: true,
      default: 'https://app.simplepost.social',
      helpText: 'Use your hosted SimplePost URL or self-hosted Scheduler app URL.',
    },
  ],
  connectionLabel: '{{bundle.authData.baseUrl}}',
};

const accountSearch = {
  key: 'simplepostAccount',
  noun: 'Account',
  display: {
    label: 'Find Connected Account',
    description: 'Finds a social account connected to SimplePost.',
  },
  operation: {
    inputFields: [{ key: 'query', label: 'Name or Platform', type: 'string', required: false }],
    perform: async (z, bundle) => {
      const accounts = await listAccounts(z, bundle);
      const query = (bundle.inputData.query || '').toLowerCase();
      return query
        ? accounts.filter((account) => `${account.name} ${account.platform} ${account.username || ''}`.toLowerCase().includes(query))
        : accounts;
    },
    sample: { id: 'account_123', name: 'SimplePost on X', platform: 'x' },
    outputFields: [
      { key: 'id', label: 'Account ID' },
      { key: 'name', label: 'Account Name' },
      { key: 'platform', label: 'Platform' },
      { key: 'username', label: 'Username' },
    ],
  },
};

const postInputFields = [
  { key: 'message', label: 'Message', type: 'text', required: false, helpText: 'The root post text. It can be empty for media-only posts.' },
  {
    key: 'accountIds',
    label: 'Accounts',
    type: 'string',
    list: true,
    required: true,
    helpText: 'Choose one or more social accounts connected in SimplePost.',
  },
  {
    key: 'postingMode',
    label: 'Posting Mode',
    type: 'string',
    required: true,
    default: 'now',
    choices: { now: 'Publish Now', schedule: 'Schedule', draft: 'Save as Draft' },
  },
  {
    key: 'scheduledFor',
    label: 'Scheduled For',
    type: 'datetime',
    required: false,
    helpText: 'Required when Posting Mode is Schedule. Use an ISO 8601 date and time.',
  },
  {
    key: 'mediaJson',
    label: 'Media (JSON)',
    type: 'text',
    required: false,
    helpText: 'Optional array of SimplePost media objects with id, url, type, filename, and size.',
  },
  { key: 'threadJson', label: 'Thread (JSON)', type: 'text', required: false, helpText: 'Optional array of additional thread segments.' },
  { key: 'accountOptionsJson', label: 'Account Options (JSON)', type: 'text', required: false, helpText: 'Optional platform-specific options keyed by account ID.' },
  { key: 'accountOverridesJson', label: 'Account Overrides (JSON)', type: 'text', required: false, helpText: 'Optional per-account content overrides keyed by account ID.' },
  { key: 'quotePostId', label: 'Quote Post ID', type: 'string', required: false },
  { key: 'repostEnabled', label: 'Automatically Repost', type: 'boolean', required: false, default: 'false' },
  { key: 'repostDelayHours', label: 'Repost Delay (Hours)', type: 'integer', required: false, default: '12' },
  { key: 'idempotencyKey', label: 'Idempotency Key', type: 'string', required: false, helpText: 'Use a stable unique value to prevent duplicate posts when a Zap retries.' },
];

const createPost = {
  key: 'createPost',
  noun: 'Post',
  display: {
    label: 'Create Post',
    description: 'Publishes immediately, schedules, or saves a SimplePost social media post.',
  },
  operation: {
    inputFields: postInputFields,
    perform: async (z, bundle) => request(z, bundle, {
      method: 'POST',
      path: '/api/v1/posts',
      body: createPostPayload(bundle.inputData),
    }),
    sample: { post: { id: 'post_123', status: 'published', message: 'Hello from Zapier' } },
    outputFields: [
      { key: 'post__id', label: 'Post ID' },
      { key: 'post__status', label: 'Status' },
      { key: 'post__scheduledFor', label: 'Scheduled For' },
      { key: 'post__publishedAt', label: 'Published At' },
    ],
  },
};

const validatePost = {
  key: 'validatePost',
  noun: 'Post',
  display: { label: 'Validate Post', description: 'Validates a post against the selected SimplePost accounts without creating it.' },
  operation: {
    inputFields: postInputFields.filter((field) => !['postingMode', 'scheduledFor', 'quotePostId', 'repostEnabled', 'repostDelayHours', 'idempotencyKey'].includes(field.key)),
    perform: async (z, bundle) => request(z, bundle, {
      method: 'POST',
      path: '/api/v1/validation',
      body: (() => {
        const payload = createPostPayload({ ...bundle.inputData, postingMode: 'now' });
        delete payload.postingMode;
        return payload;
      })(),
    }),
    sample: { summary: { isValid: true, errors: [], warnings: [] } },
    outputFields: [{ key: 'summary__isValid', label: 'Is Valid', type: 'boolean' }],
  },
};

const makePostTrigger = (key, event, label) => ({
  key,
  noun: 'Post',
  display: { label, description: `Triggers when a SimplePost post is ${event === 'post.published' ? 'published' : 'failed'}.` },
  operation: {
    type: 'hook',
    performSubscribe: async (z, bundle) => {
      const response = await request(z, bundle, {
        method: 'POST',
        path: '/api/v1/webhooks',
        body: { url: bundle.targetUrl, events: [event] },
      });
      return response.webhook;
    },
    performUnsubscribe: async (z, bundle) => request(z, bundle, {
      method: 'DELETE',
      path: `/api/v1/webhooks/${bundle.subscribeData.id}`,
    }),
    perform: async (_z, bundle) => [{ id: bundle.cleanedRequest.post.id, ...bundle.cleanedRequest }],
    performList: async (z, bundle) => {
      const type = event === 'post.published' ? 'past' : 'failed';
      const response = await request(z, bundle, { method: 'GET', path: `/api/v1/posts?type=${type}&limit=10` });
      // Match the webhook payload shape so field mappings work for both.
      return (response.posts || []).map((post) => ({
        id: post.id,
        event,
        createdAt: post.publishedAt || post.createdAt,
        post,
      }));
    },
    sample: { id: 'post_123', event, post: { id: 'post_123', status: event === 'post.published' ? 'published' : 'failed', message: 'Hello from Zapier' } },
    outputFields: [
      { key: 'event', label: 'Event' },
      { key: 'post__id', label: 'Post ID' },
      { key: 'post__status', label: 'Post Status' },
      { key: 'post__message', label: 'Message' },
    ],
  },
});

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  flags: { cleanInputData: false },
  authentication,
  beforeRequest: [(request, _z, bundle) => ({
    ...request,
    headers: { ...request.headers, Authorization: `Bearer ${bundle.authData.apiKey}` },
  })],
  searches: { [accountSearch.key]: accountSearch },
  creates: { [createPost.key]: createPost, [validatePost.key]: validatePost },
  triggers: {
    postPublished: makePostTrigger('postPublished', 'post.published', 'Post Published'),
    postFailed: makePostTrigger('postFailed', 'post.failed', 'Post Failed'),
  },
};
