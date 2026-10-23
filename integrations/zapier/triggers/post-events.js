const { request, toPostEvent } = require('../lib/simplepost');

const POLLING_LIMIT = 25;

const outputFields = [
  { key: 'id', label: 'Post ID' },
  { key: 'event', label: 'Event' },
  { key: 'eventCreatedAt', label: 'Event time', type: 'datetime' },
  { key: 'status', label: 'Post status' },
  { key: 'message', label: 'Message' },
  { key: 'url', label: 'SimplePost link' },
  { key: 'publishedAt', label: 'Published at', type: 'datetime' },
  { key: 'errorMessage', label: 'Error message' },
  { key: 'accountResults[]accountId', label: 'Account results: account ID' },
  { key: 'accountResults[]platform', label: 'Account results: platform' },
  { key: 'accountResults[]success', label: 'Account results: success', type: 'boolean' },
  { key: 'accountResults[]postUrl', label: 'Account results: published post URL' },
  { key: 'accountResults[]error', label: 'Account results: error' },
];

// SimplePost webhooks are REST hooks: each Zap registers its own endpoint
// for one event, and the polling fallback returns the same shape so samples
// pulled in the Zap editor match live webhook payloads.
const makePostTrigger = ({ key, event, listType, label, description, sample }) => ({
  key,
  noun: 'Post',
  display: { label, description },
  operation: {
    type: 'hook',
    performSubscribe: async (z, bundle) => {
      const { webhook } = await request(z, bundle, {
        method: 'POST',
        path: '/api/v1/webhooks',
        body: { url: bundle.targetUrl, events: [event] },
      });
      return webhook;
    },
    // A 404 means the endpoint was already removed in SimplePost.
    performUnsubscribe: async (z, bundle) => (await request(z, bundle, {
      method: 'DELETE',
      path: `/api/v1/webhooks/${encodeURIComponent(bundle.subscribeData.id)}`,
      ignoreStatuses: [404],
    })) || { success: true },
    perform: async (_z, bundle) => {
      const body = bundle.cleanedRequest || {};
      if (body.event !== event || !body.post?.id) return [];
      return [toPostEvent(bundle, event, body.post, body.createdAt)];
    },
    performList: async (z, bundle) => {
      const response = await request(z, bundle, {
        method: 'GET',
        path: '/api/v1/posts',
        params: { type: listType, limit: POLLING_LIMIT },
      });
      return (response.posts || []).map((post) => toPostEvent(bundle, event, post, post.publishedAt || post.updatedAt));
    },
    sample,
    outputFields,
  },
});

const newPublishedPost = makePostTrigger({
  key: 'new_published_post',
  event: 'post.published',
  listType: 'past',
  label: 'New Published Post',
  description: 'Triggers when a post is published to all of its social accounts.',
  sample: {
    id: 'cm0post123',
    event: 'post.published',
    eventCreatedAt: '2030-01-01T12:00:05.000Z',
    status: 'published',
    message: 'Our spring collection is live!',
    url: 'https://app.simplepost.social/posts/cm0post123',
    publishedAt: '2030-01-01T12:00:04.000Z',
    errorMessage: null,
    accountResults: [
      { accountId: 'cm0account123', platform: 'x', success: true, postUrl: 'https://x.com/simplepost/status/1', error: null },
    ],
  },
});

const newFailedPost = makePostTrigger({
  key: 'new_failed_post',
  event: 'post.failed',
  listType: 'failed',
  label: 'New Failed Post',
  description: 'Triggers when a post fails to publish to one or more of its social accounts.',
  sample: {
    id: 'cm0post456',
    event: 'post.failed',
    eventCreatedAt: '2030-01-01T12:00:05.000Z',
    status: 'failed',
    message: 'Our spring collection is live!',
    url: 'https://app.simplepost.social/posts/cm0post456',
    publishedAt: null,
    errorMessage: 'Reconnect your Instagram account.',
    accountResults: [
      { accountId: 'cm0account456', platform: 'instagram', success: false, postUrl: null, error: 'Reconnect your Instagram account.' },
    ],
  },
});

module.exports = { newFailedPost, newPublishedPost };
