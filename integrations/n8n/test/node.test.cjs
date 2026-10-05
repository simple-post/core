const assert = require('node:assert/strict');
const test = require('node:test');

const { SimplePost } = require('../dist/nodes/SimplePost/SimplePost.node.js');
const { SimplePostTrigger } = require('../dist/nodes/SimplePost/SimplePostTrigger.node.js');
const { signWebhookBody } = require('../dist/nodes/SimplePost/shared.js');

const node = {
	name: 'SimplePost',
	type: 'simplePost',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

// Minimal stand-in for n8n's execution context: records requests and replays
// canned API responses in order.
function createContext({ params, responses = [], binary, continueOnFail = false }) {
	const requests = [];
	const queue = [...responses];
	const context = {
		getInputData: () => [{ json: {} }],
		getNodeParameter: (name, _itemIndex, fallback) => {
			if (name in params) return params[name];
			if (fallback !== undefined) return fallback;
			throw new Error(`Missing parameter ${name}`);
		},
		getNode: () => node,
		continueOnFail: () => continueOnFail,
		getCredentials: async () => ({
			apiKey: 'sp_api_test',
			baseUrl: 'https://scheduler.example.com/',
		}),
		helpers: {
			httpRequestWithAuthentication: async (credentialType, options) => {
				requests.push({ credentialType, ...options });
				return queue.shift();
			},
			httpRequest: async (options) => {
				requests.push({ credentialType: null, ...options });
				return '';
			},
			returnJsonArray: (data) => (Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			constructExecutionMetaData: (items, { itemData }) =>
				items.map((item) => ({ ...item, pairedItem: itemData })),
			assertBinaryData: () => binary.meta,
			getBinaryDataBuffer: async () => binary.buffer,
		},
	};
	return { context, requests };
}

test('create sends the Scheduler post contract', async () => {
	const { context, requests } = createContext({
		params: {
			resource: 'post',
			operation: 'create',
			accountIds: ['acc_x', 'acc_li'],
			message: 'Hello',
			postingMode: 'schedule',
			scheduledFor: '2030-01-01T10:00:00+01:00',
			media: {
				items: [
					{ url: 'https://cdn.example.com/p.png', type: 'image', filename: '', thumbnailUrl: '' },
				],
			},
			additionalFields: {
				accountOptionsJson: '{"acc_li":{"visibility":"PUBLIC"}}',
				accountOverridesJson: '{}',
				threadJson: [{ message: 'Two' }],
				repostEnabled: true,
				repostDelayHours: 6,
				imageFit: 'blur',
				idempotencyKey: 'run-1',
			},
		},
		responses: [{ post: { id: 'post_1', status: 'scheduled' }, warnings: [] }],
	});

	const [output] = await new SimplePost().execute.call(context);

	assert.equal(requests.length, 1);
	const [request] = requests;
	assert.equal(request.credentialType, 'simplePostApi');
	assert.equal(request.method, 'POST');
	assert.equal(request.baseURL, 'https://scheduler.example.com');
	assert.equal(request.url, '/api/v1/posts');
	assert.equal(request.body.scheduledFor, '2030-01-01T09:00:00.000Z');
	assert.deepEqual(request.body.accountIds, ['acc_x', 'acc_li']);
	assert.equal(request.body.media[0].filename, 'p.png');
	assert.equal(request.body.media[0].size, 0);
	assert.ok(request.body.media[0].id);
	assert.equal('thumbnailUrl' in request.body.media[0], false);
	assert.deepEqual(request.body.accountOptions, { acc_li: { visibility: 'PUBLIC' } });
	assert.equal('accountOverrides' in request.body, false);
	assert.deepEqual(request.body.thread, [{ message: 'Two' }]);
	assert.deepEqual(request.body.repost, { enabled: true, delayHours: 6 });
	assert.equal(request.body.imageFit, 'blur');
	assert.equal(request.body.idempotencyKey, 'run-1');
	assert.deepEqual(output[0].pairedItem, { item: 0 });
	assert.equal(output[0].json.post.id, 'post_1');
});

test('create fails the item when publishing failed', async () => {
	const failed = {
		post: { id: 'post_2', status: 'failed', errorMessage: 'Token expired' },
		summary: {},
	};
	const params = {
		resource: 'post',
		operation: 'create',
		accountIds: ['acc_x'],
		message: 'Hello',
		postingMode: 'now',
		media: {},
		additionalFields: {},
	};

	const { context } = createContext({ params, responses: [failed] });
	await assert.rejects(new SimplePost().execute.call(context), /Token expired/);

	const tolerant = createContext({ params, responses: [failed], continueOnFail: true });
	const [output] = await new SimplePost().execute.call(tolerant.context);
	assert.match(output[0].json.error, /Token expired/);
	assert.equal(output[0].json.post.id, 'post_2');
});

test('get many pages through results up to the limit', async () => {
	const page = (ids, hasNextPage) => ({
		posts: ids.map((id) => ({ id })),
		pagination: { hasNextPage },
	});
	const { context, requests } = createContext({
		params: { resource: 'post', operation: 'getAll', status: 'past', returnAll: true },
		responses: [page(['a', 'b'], true), page(['c'], false)],
	});

	const [output] = await new SimplePost().execute.call(context);

	assert.deepEqual(
		output.map((item) => item.json.id),
		['a', 'b', 'c'],
	);
	assert.deepEqual(requests[0].qs, { type: 'past', page: 1, limit: 100 });
	assert.deepEqual(requests[1].qs, { type: 'past', page: 2, limit: 100 });
});

test('delete returns the n8n deletion confirmation', async () => {
	const { context, requests } = createContext({
		params: { resource: 'post', operation: 'delete', postId: 'post/1' },
		responses: [{ success: true }],
	});

	const [output] = await new SimplePost().execute.call(context);

	assert.equal(requests[0].method, 'DELETE');
	assert.equal(requests[0].url, '/api/v1/posts/post%2F1');
	assert.deepEqual(output[0].json, { deleted: true });
});

test('media upload presigns, uploads the bytes, and returns a post media object', async () => {
	const buffer = Buffer.from('fake-png');
	const { context, requests } = createContext({
		params: { resource: 'media', operation: 'upload', binaryPropertyName: 'data' },
		binary: { meta: { mimeType: 'image/png', fileName: 'cover.png' }, buffer },
		responses: [
			{
				uploadUrl: 'https://storage.example.com/put',
				publicUrl: 'https://media.example.com/cover.png',
			},
		],
	});

	const [output] = await new SimplePost().execute.call(context);

	assert.equal(requests[0].url, '/api/v1/upload/presign');
	assert.deepEqual(requests[0].body, {
		filename: 'cover.png',
		contentType: 'image/png',
		size: buffer.length,
	});
	assert.equal(requests[1].credentialType, null);
	assert.equal(requests[1].method, 'PUT');
	assert.equal(requests[1].url, 'https://storage.example.com/put');
	assert.equal(requests[1].body, buffer);
	assert.equal(output[0].json.url, 'https://media.example.com/cover.png');
	assert.equal(output[0].json.type, 'image');
	assert.equal(output[0].json.size, buffer.length);
});

test('account loader hides preview-only accounts and flags reconnects', async () => {
	const { context } = createContext({
		params: {},
		responses: [
			{
				accounts: [
					{ id: 'a', platform: 'x', username: 'simplepost' },
					{
						id: 'b',
						platform: 'linkedin',
						displayName: 'Vlad',
						credentialStatus: { state: 'reauth_required' },
					},
					{ id: 'c', platform: 'instagram', previewOnly: true },
				],
			},
		],
	});

	const options = await new SimplePost().methods.loadOptions.getAccounts.call(context);

	assert.deepEqual(options, [
		{ name: 'simplepost (x)', value: 'a' },
		{ name: 'Vlad (linkedin) – reconnect required', value: 'b' },
	]);
});

function createWebhookContext({ secret, body, headers, events = ['post.published'] }) {
	let status;
	return {
		context: {
			getWorkflowStaticData: () => ({ webhookId: 'wh_1', webhookSecret: secret }),
			getRequestObject: () => ({ rawBody: Buffer.from(body) }),
			getHeaderData: () => headers,
			getBodyData: () => JSON.parse(body),
			getNodeParameter: () => events,
			getResponseObject: () => ({
				status(code) {
					status = code;
					return this;
				},
				json() {
					return this;
				},
			}),
			helpers: { returnJsonArray: (data) => [{ json: data }] },
		},
		getStatus: () => status,
	};
}

test('trigger accepts signed deliveries and rejects forged ones', async () => {
	const secret = 'whsec_test';
	const body = JSON.stringify({ event: 'post.published', post: { id: 'post_1' } });
	const timestamp = String(Date.now());
	const signature = `sha256=${signWebhookBody(secret, timestamp, body)}`;

	const valid = createWebhookContext({
		secret,
		body,
		headers: { 'x-simplepost-timestamp': timestamp, 'x-simplepost-signature': signature },
	});
	const accepted = await new SimplePostTrigger().webhook.call(valid.context);
	assert.equal(accepted.workflowData[0][0].json.post.id, 'post_1');

	const forged = createWebhookContext({
		secret,
		body,
		headers: { 'x-simplepost-timestamp': timestamp, 'x-simplepost-signature': 'sha256=00' },
	});
	const rejected = await new SimplePostTrigger().webhook.call(forged.context);
	assert.deepEqual(rejected, { noWebhookResponse: true });
	assert.equal(forged.getStatus(), 401);

	const unsubscribed = createWebhookContext({
		secret,
		body,
		headers: { 'x-simplepost-timestamp': timestamp, 'x-simplepost-signature': signature },
		events: ['post.failed'],
	});
	const ignored = await new SimplePostTrigger().webhook.call(unsubscribed.context);
	assert.equal(ignored.workflowData, undefined);
});
