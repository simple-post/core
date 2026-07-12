const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_BASE_URL, normalizeBaseUrl } = require('../dist/lib/simplepost.js');

test('normalizes hosted and self-hosted SimplePost URLs', () => {
  assert.equal(DEFAULT_BASE_URL, 'https://app.simplepost.social');
  assert.equal(normalizeBaseUrl('https://scheduler.example.com///'), 'https://scheduler.example.com');
});
