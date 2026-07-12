const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_BASE_URL, normalizeBaseUrl, normalizeScheduledFor, toSimplePostAuth } = require('../dist/lib/simplepost.js');

test('normalizes hosted and self-hosted SimplePost URLs', () => {
  assert.equal(DEFAULT_BASE_URL, 'https://app.simplepost.social');
  assert.equal(normalizeBaseUrl('https://scheduler.example.com///'), 'https://scheduler.example.com');
});

test('normalizes scheduled times to UTC', () => {
  assert.equal(normalizeScheduledFor('2030-01-01T14:00:00+02:00'), '2030-01-01T12:00:00.000Z');
  assert.throws(() => normalizeScheduledFor('not-a-date'), /valid date and time/);
  assert.throws(() => normalizeScheduledFor(undefined), /valid date and time/);
});

test('unwraps connection values and raw auth props', () => {
  assert.deepEqual(toSimplePostAuth({ apiKey: 'key', baseUrl: 'https://example.com' }), {
    apiKey: 'key',
    baseUrl: 'https://example.com',
  });
  assert.deepEqual(toSimplePostAuth({ type: 'CUSTOM_AUTH', props: { apiKey: 'key' } }), { apiKey: 'key' });
});
