const assert = require('node:assert/strict');
const test = require('node:test');

const {
	normalizeBaseUrl,
	normalizeScheduledFor,
	parseOptionalArray,
	parseOptionalObject,
} = require('../dist/nodes/SimplePost/shared.js');

const getNode = () => ({ name: 'SimplePost', type: 'simplePost', typeVersion: 1, position: [0, 0], parameters: {} });

test('normalizeBaseUrl removes trailing slashes', () => {
	assert.equal(normalizeBaseUrl('https://app.simplepost.social///'), 'https://app.simplepost.social');
});

test('optional JSON helpers accept objects and arrays', () => {
	assert.deepEqual(parseOptionalObject('{"account":{"title":"Post"}}', 'Options', getNode), {
		account: { title: 'Post' },
	});
	assert.deepEqual(parseOptionalArray('[{"message":"Part two"}]', 'Thread', getNode), [
		{ message: 'Part two' },
	]);
});

test('optional JSON helpers omit blank values', () => {
	assert.equal(parseOptionalObject(' ', 'Options', getNode), undefined);
	assert.equal(parseOptionalArray('', 'Thread', getNode), undefined);
});

test('optional JSON helpers reject the wrong shape', () => {
	assert.throws(() => parseOptionalObject('[]', 'Options', getNode), /must be a JSON object/);
	assert.throws(() => parseOptionalArray('{}', 'Thread', getNode), /must be a JSON array/);
});

test('normalizeScheduledFor converts offset timestamps to UTC', () => {
	assert.equal(normalizeScheduledFor('2026-08-01T09:30:00.000+02:00', getNode), '2026-08-01T07:30:00.000Z');
	assert.equal(normalizeScheduledFor('2026-08-01T07:30:00Z', getNode), '2026-08-01T07:30:00.000Z');
});

test('normalizeScheduledFor rejects invalid values', () => {
	assert.throws(() => normalizeScheduledFor('', getNode), /valid date and time/);
	assert.throws(() => normalizeScheduledFor('not-a-date', getNode), /valid date and time/);
});
