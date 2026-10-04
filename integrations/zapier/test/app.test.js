const assert = require('node:assert/strict');
const test = require('node:test');

const nock = require('nock');
const zapier = require('zapier-platform-core');

const App = require('../index');

const appTester = zapier.createAppTester(App);
const BASE_URL = 'https://app.simplepost.social';
const authData = { apiKey: 'sp_api_test', baseUrl: BASE_URL };

const api = () => nock(BASE_URL, { reqheaders: { authorization: 'Bearer sp_api_test' } });

test.beforeEach(() => nock.disableNetConnect());
test.afterEach(() => {
  const pending = nock.pendingMocks();
  nock.cleanAll();
  nock.enableNetConnect();
  assert.deepEqual(pending, []);
});

const accounts = [
  { id: 'acc_x', platform: 'x', username: 'simplepost', displayName: 'SimplePost', previewOnly: false, credentialStatus: { state: 'ok' } },
  { id: 'acc_ig', platform: 'instagram', username: 'sp', displayName: null, previewOnly: false, credentialStatus: { state: 'reauth_required' } },
  { id: 'acc_preview', platform: 'linkedin', username: 'preview', previewOnly: true, credentialStatus: { state: 'ok' } },
];

test('authentication test lists accounts and builds a connection label', async () => {
  api().get('/api/v1/accounts').reply(200, { accounts });
  const bundle = { authData, inputData: {} };
  const result = await appTester(App.authentication.test, bundle);
  assert.equal(result.accounts.length, 2);

  const label = App.authentication.connectionLabel(null, { authData, inputData: result });
  assert.equal(label, 'SimplePost (@simplepost) · x + 1 more');
});

test('a revoked key raises an expired-auth error', async () => {
  api().get('/api/v1/accounts').reply(401, { error: 'Authentication required', code: 'UNAUTHORIZED' });
  await assert.rejects(appTester(App.authentication.test, { authData, inputData: {} }), (error) => error.name === 'ExpiredAuthError');
});

test('a plan without API access surfaces the API message', async () => {
  api().get('/api/v1/accounts').reply(402, { error: 'Your plan does not include API access.', code: 'PAYMENT_REQUIRED' });
  await assert.rejects(appTester(App.authentication.test, { authData, inputData: {} }), /does not include API access/);
});

test('account dropdown hides preview-only accounts', async () => {
  api().get('/api/v1/accounts').reply(200, { accounts });
  const results = await appTester(App.triggers.account_list.operation.perform, { authData, inputData: {} });
  assert.deepEqual(results.map((account) => [account.id, account.needsReconnect]), [['acc_x', false], ['acc_ig', true]]);
});

test('find account matches username and platform', async () => {
  api().get('/api/v1/accounts').reply(200, { accounts });
  const results = await appTester(App.searches.find_account.operation.perform, { authData, inputData: { query: 'instagram' } });
  assert.deepEqual(results.map((account) => account.id), ['acc_ig']);
});

test('create post schedules and returns a flat post with a link', async () => {
  api()
    .post('/api/v1/posts', {
      message: 'Hello',
      accountIds: ['acc_x'],
      postingMode: 'schedule',
      scheduledFor: '2030-01-01T12:00:00.000Z',
      idempotencyKey: 'row-1',
    })
    .reply(201, {
      post: { id: 'post_1', status: 'scheduled', message: 'Hello', accountIds: ['acc_x'], scheduledFor: '2030-01-01T12:00:00.000Z', createdAt: '2029-12-31T00:00:00.000Z' },
      warnings: [],
    });

  const result = await appTester(App.creates.create_post.operation.perform, {
    authData,
    inputData: { message: 'Hello', accountIds: ['acc_x'], postingMode: 'schedule', scheduledFor: '2030-01-01T14:00:00+02:00', idempotencyKey: 'row-1' },
  });

  assert.equal(result.id, 'post_1');
  assert.equal(result.status, 'scheduled');
  assert.equal(result.url, `${BASE_URL}/posts/post_1`);
  assert.deepEqual(Object.keys(result).sort(), Object.keys(App.creates.create_post.operation.sample).sort());
});

test('create post sends file URLs as media without leaking the API key', async () => {
  const fileUrl = 'https://files.example.com/stash/abc?X-Amz-Signature=sig';
  nock('https://files.example.com', { badheaders: ['authorization'] })
    .get('/stash/abc')
    .query(true)
    .matchHeader('range', 'bytes=0-0')
    .reply(206, 'x', { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-0/5000' });
  api()
    .post('/api/v1/posts', (body) => body.media?.[0]?.type === 'video' && body.media[0].size === 5000 && body.media[0].url === fileUrl)
    .reply(201, { post: { id: 'post_4', status: 'published', message: '', accountIds: ['acc_x'] }, summary: { overallSuccess: true } });

  const result = await appTester(App.creates.create_post.operation.perform, {
    authData,
    inputData: { accountIds: ['acc_x'], mediaUrls: [fileUrl] },
  });
  assert.equal(result.status, 'published');
});

test('create post turns a failed publish into a Zap error', async () => {
  api().post('/api/v1/posts').reply(201, {
    post: {
      id: 'post_2',
      status: 'failed',
      message: 'Hello',
      errorMessage: 'Failed on 1 platform(s)',
      accountResults: {
        acc_x: { accountId: 'acc_x', platform: 'x', success: true, postUrl: 'https://x.com/s/1' },
        acc_ig: { accountId: 'acc_ig', platform: 'instagram', success: false, message: 'Reconnect Instagram.' },
      },
    },
    summary: { overallSuccess: false },
  });

  await assert.rejects(
    appTester(App.creates.create_post.operation.perform, { authData, inputData: { accountIds: ['acc_x', 'acc_ig'], message: 'Hello' } }),
    /instagram: Reconnect Instagram\..*published to x/,
  );
});

test('create post reports validation details', async () => {
  api().post('/api/v1/posts').reply(400, {
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: { summary: { isValid: false, errors: [{ message: 'Instagram posts need media.' }], warnings: [] } },
  });
  await assert.rejects(
    appTester(App.creates.create_post.operation.perform, { authData, inputData: { accountIds: ['acc_ig'], message: 'Hi' } }),
    /Instagram posts need media\./,
  );
});

test('validate post returns issues as line items', async () => {
  api()
    .post('/api/v1/validation', { message: 'Hi', accountIds: ['acc_ig'] })
    .reply(200, {
      accounts: [],
      summary: { isValid: false, errors: [{ platform: 'instagram', severity: 'error', code: 'media_required', field: 'media', message: 'Instagram posts need media.' }], warnings: [] },
    });

  const result = await appTester(App.creates.validate_post.operation.perform, { authData, inputData: { accountIds: ['acc_ig'], message: 'Hi' } });
  assert.equal(result.isValid, false);
  assert.equal(result.errorSummary, 'Instagram posts need media.');
  assert.deepEqual(result.errors, [{ platform: 'instagram', code: 'media_required', field: 'media', message: 'Instagram posts need media.' }]);
});

test('post published trigger subscribes, receives, lists, and unsubscribes', async () => {
  const trigger = App.triggers.new_published_post.operation;
  const targetUrl = 'https://hooks.zapier.com/hooks/standard/1/abc';

  api()
    .post('/api/v1/webhooks', { url: targetUrl, events: ['post.published'] })
    .reply(201, { webhook: { id: 'wh_1', url: targetUrl, events: ['post.published'], secret: 'whsec_x' } });
  const subscribeData = await appTester(trigger.performSubscribe, { authData, targetUrl, inputData: {} });
  assert.equal(subscribeData.id, 'wh_1');

  const hookPost = { id: 'post_3', status: 'published', message: 'Live', publishedAt: '2030-01-01T12:00:04.000Z', accountResults: {} };
  const fromHook = await appTester(trigger.perform, {
    authData,
    inputData: {},
    cleanedRequest: { event: 'post.published', createdAt: '2030-01-01T12:00:05.000Z', post: hookPost },
  });
  assert.equal(fromHook.length, 1);
  assert.equal(fromHook[0].id, 'post_3');

  const ignored = await appTester(trigger.perform, {
    authData,
    inputData: {},
    cleanedRequest: { event: 'post.failed', post: { id: 'post_3' } },
  });
  assert.deepEqual(ignored, []);

  api()
    .get('/api/v1/posts')
    .query({ type: 'past', limit: '25' })
    .reply(200, { posts: [{ ...hookPost, accountIds: [], media: [], createdAt: '2030-01-01T11:00:00.000Z', updatedAt: '2030-01-01T12:00:04.000Z' }] });
  const fromList = await appTester(trigger.performList, { authData, inputData: {} });
  assert.deepEqual(Object.keys(fromList[0]).sort(), Object.keys(fromHook[0]).sort());
  assert.deepEqual(Object.keys(fromList[0]).sort(), Object.keys(trigger.sample).sort());

  api().delete('/api/v1/webhooks/wh_1').reply(404, { error: 'Webhook endpoint not found', code: 'NOT_FOUND' });
  assert.deepEqual(await appTester(trigger.performUnsubscribe, { authData, subscribeData, inputData: {} }), { success: true });
});
