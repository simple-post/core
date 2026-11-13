const { createPostPayload, failedPublishMessage, request, toPostOutput } = require('../lib/simplepost');
const { accountIds, advancedFields, imageFit, mediaUrls, message, threadMessages } = require('./fields');

const inputFields = [
  accountIds,
  message,
  {
    key: 'postingMode',
    label: 'When to post',
    type: 'string',
    required: true,
    default: 'now',
    choices: [
      { value: 'now', label: 'Publish now', sample: 'now' },
      { value: 'schedule', label: 'Schedule', sample: 'schedule' },
      { value: 'draft', label: 'Save as draft', sample: 'draft' },
    ],
    helpText: 'Publishing now waits for every platform to respond. For videos or many accounts, schedule the post a few minutes ahead instead.',
  },
  {
    key: 'scheduledFor',
    label: 'Schedule for',
    type: 'datetime',
    required: false,
    helpText: 'Required when **When to post** is **Schedule**. Must be in the future.',
  },
  mediaUrls,
  imageFit,
  threadMessages,
  {
    key: 'idempotencyKey',
    label: 'Deduplication key',
    type: 'string',
    required: false,
    helpText: 'Map a value that is unique to the triggering item, such as its ID. If the Zap runs again with the same key, SimplePost returns the existing post instead of posting twice.',
  },
  {
    key: 'repostEnabled',
    label: 'Repost automatically',
    type: 'boolean',
    required: false,
    default: 'false',
    helpText: 'Repost the published post after the delay below on platforms that support reposts.',
  },
  {
    key: 'repostDelayHours',
    label: 'Repost delay (hours)',
    type: 'integer',
    required: false,
    default: '12',
  },
  {
    key: 'quotePostId',
    label: 'Quote post',
    type: 'string',
    required: false,
    dynamic: 'new_published_post.id.message',
    helpText: 'A published SimplePost post to quote on platforms that support quote posts.',
  },
  ...advancedFields,
];

const outputFields = [
  { key: 'id', label: 'Post ID' },
  { key: 'status', label: 'Status' },
  { key: 'message', label: 'Message' },
  { key: 'url', label: 'SimplePost link' },
  { key: 'scheduledFor', label: 'Scheduled for', type: 'datetime' },
  { key: 'publishedAt', label: 'Published at', type: 'datetime' },
  { key: 'createdAt', label: 'Created at', type: 'datetime' },
  { key: 'errorMessage', label: 'Error message' },
  { key: 'replayed', label: 'Existing post returned for deduplication key', type: 'boolean' },
  { key: 'accountResults[]accountId', label: 'Account results: account ID' },
  { key: 'accountResults[]platform', label: 'Account results: platform' },
  { key: 'accountResults[]success', label: 'Account results: success', type: 'boolean' },
  { key: 'accountResults[]postUrl', label: 'Account results: published post URL' },
  { key: 'accountResults[]error', label: 'Account results: error' },
];

module.exports = {
  key: 'create_post',
  noun: 'Post',
  display: {
    label: 'Create Post',
    description: 'Publishes, schedules, or saves a draft social media post to one or more connected accounts.',
  },
  operation: {
    inputFields,
    perform: async (z, bundle) => {
      const body = await request(z, bundle, {
        method: 'POST',
        path: '/api/v1/posts',
        body: await createPostPayload(z, bundle.inputData),
      });
      const output = toPostOutput(bundle, body);

      // A publish-now post that failed on any platform comes back as HTTP 201
      // with status "failed". Surface it as a Zap error so the owner is told.
      if (output.status === 'failed') throw new z.errors.Error(failedPublishMessage(output), 'PublishFailed', 422);

      return output;
    },
    sample: {
      id: 'cm0post123',
      status: 'published',
      message: 'Our spring collection is live!',
      url: 'https://app.simplepost.social/posts/cm0post123',
      scheduledFor: '2030-01-01T12:00:00.000Z',
      publishedAt: '2030-01-01T12:00:04.000Z',
      createdAt: '2030-01-01T12:00:00.000Z',
      accountIds: ['cm0account123'],
      errorMessage: null,
      accountResults: [
        { accountId: 'cm0account123', platform: 'x', success: true, postUrl: 'https://x.com/simplepost/status/1', error: null },
      ],
      replayed: false,
      warnings: [],
    },
    outputFields,
  },
};
