const assert = require('node:assert/strict');
const test = require('node:test');

const { createPostPayload, normalizeBaseUrl, normalizeScheduledFor, parseJson } = require('../lib/simplepost');

test('normalizes a Scheduler base URL', () => {
  assert.equal(normalizeBaseUrl('https://app.simplepost.social///'), 'https://app.simplepost.social');
});

test('creates a post payload with advanced API fields', () => {
  assert.deepEqual(createPostPayload({
    message: 'Hello',
    accountIds: ['account_1'],
    postingMode: 'schedule',
    scheduledFor: '2030-01-01T12:00:00Z',
    mediaJson: '[{"id":"media_1","url":"https://example.com/image.jpg","type":"image","filename":"image.jpg","size":1}]',
    accountOptionsJson: '{"account_1":{"title":"Title"}}',
    repostEnabled: true,
    repostDelayHours: 24,
  }), {
    message: 'Hello',
    accountIds: ['account_1'],
    postingMode: 'schedule',
    scheduledFor: '2030-01-01T12:00:00.000Z',
    media: [{ id: 'media_1', url: 'https://example.com/image.jpg', type: 'image', filename: 'image.jpg', size: 1 }],
    accountOptions: { account_1: { title: 'Title' } },
    repost: { enabled: true, delayHours: 24 },
  });
});

test('normalizes scheduled times to UTC', () => {
  assert.equal(normalizeScheduledFor('2030-01-01T14:00:00+02:00'), '2030-01-01T12:00:00.000Z');
  assert.throws(() => normalizeScheduledFor('not-a-date'), /valid date and time/);
  assert.throws(() => createPostPayload({ accountIds: ['a'], postingMode: 'schedule' }), /valid date and time/);
});

test('treats a "false" repost string as disabled', () => {
  const payload = createPostPayload({ accountIds: ['a'], postingMode: 'now', repostEnabled: 'false' });
  assert.equal(payload.repost, undefined);
});

test('rejects malformed advanced JSON', () => {
  assert.throws(() => parseJson('{', 'Account Options'), /valid JSON/);
  assert.throws(() => parseJson('[]', 'Account Options'), /JSON object/);
});
