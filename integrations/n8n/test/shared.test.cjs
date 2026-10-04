const assert = require('node:assert/strict');
const test = require('node:test');

const {
	filenameFromUrl,
	isValidWebhookSignature,
	normalizeBaseUrl,
	normalizeScheduledFor,
	parseOptionalArray,
	parseOptionalObject,
	signWebhookBody,
} = require('../dist/nodes/SimplePost/shared.js');

const node = {
	name: 'SimplePost',
	type: 'simplePost',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

test('normalizeBaseUrl trims slashes and falls back to the hosted app', () => {
	assert.equal(
		normalizeBaseUrl('https://app.simplepost.social///'),
		'https://app.simplepost.social',
	);
	assert.equal(normalizeBaseUrl(''), 'https://app.simplepost.social');
});

test('optional JSON helpers accept strings and expression objects', () => {
	assert.deepEqual(parseOptionalObject('{"account":{"title":"Post"}}', 'Options', node), {
		account: { title: 'Post' },
	});
	assert.deepEqual(parseOptionalObject({ account: { title: 'Post' } }, 'Options', node), {
		account: { title: 'Post' },
	});
	assert.deepEqual(parseOptionalArray('[{"message":"Part two"}]', 'Thread', node), [
		{ message: 'Part two' },
	]);
	assert.deepEqual(parseOptionalArray([{ message: 'Part two' }], 'Thread', node), [
		{ message: 'Part two' },
	]);
});

test('optional JSON helpers omit blank values', () => {
	assert.equal(parseOptionalObject(' ', 'Options', node), undefined);
	assert.equal(parseOptionalObject(undefined, 'Options', node), undefined);
	assert.equal(parseOptionalArray('', 'Thread', node), undefined);
});

test('optional JSON helpers reject the wrong shape', () => {
	assert.throws(() => parseOptionalObject('[]', 'Options', node), /must be a JSON object/);
	assert.throws(() => parseOptionalObject('{', 'Options', node), /not valid JSON/);
	assert.throws(() => parseOptionalArray('{}', 'Thread', node), /must be a JSON array/);
});

test('normalizeScheduledFor converts offset timestamps to UTC', () => {
	assert.equal(
		normalizeScheduledFor('2026-08-01T09:30:00.000+02:00', node),
		'2026-08-01T07:30:00.000Z',
	);
	assert.equal(normalizeScheduledFor('2026-08-01T07:30:00Z', node), '2026-08-01T07:30:00.000Z');
});

test('normalizeScheduledFor rejects invalid values', () => {
	assert.throws(() => normalizeScheduledFor('', node), /not a valid date and time/);
	assert.throws(() => normalizeScheduledFor('not-a-date', node), /not a valid date and time/);
});

test('filenameFromUrl uses the URL path and falls back by media type', () => {
	assert.equal(
		filenameFromUrl('https://cdn.example.com/a/photo%201.png?x=1', 'image'),
		'photo 1.png',
	);
	assert.equal(filenameFromUrl('https://cdn.example.com/', 'video'), 'simplepost-media.mp4');
	assert.equal(filenameFromUrl('not a url', 'image'), 'simplepost-media.jpg');
});

test('webhook signatures match the Scheduler signing scheme', () => {
	const secret = 'whsec_test';
	const body = '{"event":"post.published"}';
	const now = 1_790_000_000_000;
	const timestamp = String(now);
	const signature = `sha256=${signWebhookBody(secret, timestamp, body)}`;

	assert.equal(isValidWebhookSignature(secret, timestamp, signature, body, now), true);
	assert.equal(isValidWebhookSignature(secret, timestamp, signature, `${body} `, now), false);
	assert.equal(isValidWebhookSignature('whsec_other', timestamp, signature, body, now), false);
	assert.equal(isValidWebhookSignature(secret, timestamp, signature.slice(7), body, now), false);
	assert.equal(isValidWebhookSignature(secret, undefined, signature, body, now), false);
	assert.equal(
		isValidWebhookSignature(secret, timestamp, signature, body, now + 6 * 60 * 1000),
		false,
		'stale deliveries are rejected',
	);
});
