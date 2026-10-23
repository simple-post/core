const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createPostPayload,
  describeApiError,
  normalizeBaseUrl,
  normalizeScheduledFor,
  parseJson,
  toPostEvent,
} = require('../lib/simplepost');

// Pure payload tests never reach the network; media URLs need a z.request stub.
const offlineZ = { request: async () => { throw new Error('offline'); } };
const bundle = { authData: { baseUrl: 'https://app.simplepost.social' } };

test('normalizes and validates the Scheduler URL', () => {
  assert.equal(normalizeBaseUrl('https://app.simplepost.social///'), 'https://app.simplepost.social');
  assert.equal(normalizeBaseUrl(''), 'https://app.simplepost.social');
  assert.equal(normalizeBaseUrl('http://localhost:3000/'), 'http://localhost:3000');
  assert.throws(() => normalizeBaseUrl('http://simplepost.example.com'), /HTTPS/);
  assert.throws(() => normalizeBaseUrl('simplepost.example.com'), /full URL/);
  assert.throws(() => normalizeBaseUrl('https://user:pass@simplepost.example.com'), /credentials/);
});

test('creates a post payload with advanced API fields', async () => {
  assert.deepEqual(await createPostPayload(offlineZ, {
    message: 'Hello',
    accountIds: ['account_1', ''],
    postingMode: 'schedule',
    scheduledFor: '2030-01-01T12:00:00Z',
    mediaJson: '[{"id":"media_1","url":"https://example.com/image.jpg","type":"image","filename":"image.jpg","size":1}]',
    threadMessages: ['Second', ''],
    accountOptionsJson: '{"account_1":{"title":"Title"}}',
    imageFit: 'blur',
    repostEnabled: true,
    repostDelayHours: 24,
  }), {
    message: 'Hello',
    accountIds: ['account_1'],
    postingMode: 'schedule',
    scheduledFor: '2030-01-01T12:00:00.000Z',
    media: [{ id: 'media_1', url: 'https://example.com/image.jpg', type: 'image', filename: 'image.jpg', size: 1 }],
    thread: [{ message: 'Second' }],
    accountOptions: { account_1: { title: 'Title' } },
    imageFit: 'blur',
    repost: { enabled: true, delayHours: 24 },
  });
});

test('builds media from file URLs using the Content-Type header', async () => {
  const z = {
    request: async ({ url, method, headers }) => {
      assert.equal(method, 'GET');
      assert.equal(headers.Range, 'bytes=0-0');
      return {
        status: url.includes('clip') ? 200 : 206,
        headers: new Map([
          ['content-type', url.includes('clip') ? 'video/mp4' : 'image/png; charset=binary'],
          ['content-range', 'bytes 0-0/2048'],
          ['content-length', url.includes('clip') ? '2048' : '1'],
        ]),
      };
    },
  };
  const { media } = await createPostPayload(z, {
    accountIds: ['a'],
    mediaUrls: ['https://files.example.com/abc', 'https://files.example.com/clip'],
  });
  assert.deepEqual(media.map(({ type, size, contentType }) => ({ type, size, contentType })), [
    { type: 'image', size: 2048, contentType: 'image/png' },
    { type: 'video', size: 2048, contentType: 'video/mp4' },
  ]);
  assert.notEqual(media[0].id, media[1].id);
});

test('falls back to the file extension when HEAD fails', async () => {
  const { media } = await createPostPayload(offlineZ, { accountIds: ['a'], mediaUrls: 'https://example.com/v/launch.MOV' });
  assert.equal(media[0].type, 'video');
  assert.equal(media[0].filename, 'launch.MOV');
  assert.equal(media[0].size, 0);
  await assert.rejects(createPostPayload(offlineZ, { accountIds: ['a'], mediaUrls: ['ftp://example.com/a.png'] }), /public file URL/);
});

test('normalizes scheduled times to UTC', async () => {
  assert.equal(normalizeScheduledFor('2030-01-01T14:00:00+02:00'), '2030-01-01T12:00:00.000Z');
  assert.throws(() => normalizeScheduledFor('not-a-date'), /valid date and time/);
  await assert.rejects(createPostPayload(offlineZ, { accountIds: ['a'], postingMode: 'schedule' }), /valid date and time/);
});

test('treats a "false" repost string as disabled and defaults to publishing now', async () => {
  const payload = await createPostPayload(offlineZ, { accountIds: ['a'], repostEnabled: 'false' });
  assert.equal(payload.repost, undefined);
  assert.equal(payload.postingMode, 'now');
});

test('rejects malformed advanced JSON', () => {
  assert.throws(() => parseJson('{', 'Account options (JSON)'), /valid JSON/);
  assert.throws(() => parseJson('[]', 'Account options (JSON)'), /JSON object/);
});

test('summarizes validation errors from the API', () => {
  assert.equal(
    describeApiError(400, {
      error: 'Validation failed',
      details: { summary: { errors: [{ message: 'Text is too long for X.' }, { message: 'Instagram needs media.' }] } },
    }),
    'Validation failed Text is too long for X. Instagram needs media.',
  );
  assert.equal(describeApiError(500, {}), 'SimplePost responded with HTTP 500.');
});

test('maps webhook and polling posts to the same event shape', () => {
  const fromHook = toPostEvent(bundle, 'post.failed', { id: 'p1', status: 'failed', message: 'Hi', errorMessage: 'Boom' }, '2030-01-01T00:00:00Z');
  const fromList = toPostEvent(bundle, 'post.failed', {
    id: 'p1',
    status: 'failed',
    message: 'Hi',
    errorMessage: 'Boom',
    accountResults: { a: { accountId: 'a', platform: 'x', success: false, error: 'rate_limited', message: 'Slow down' } },
    media: [],
  }, '2030-01-01T00:00:00Z');

  assert.deepEqual(Object.keys(fromHook).sort(), Object.keys(fromList).sort());
  assert.equal(fromHook.url, 'https://app.simplepost.social/posts/p1');
  assert.deepEqual(fromList.accountResults, [{ accountId: 'a', platform: 'x', success: false, postUrl: null, error: 'Slow down' }]);
});
