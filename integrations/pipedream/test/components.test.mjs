import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('app source uses SimplePost bearer API-key authentication', () => {
  const app = source('components/simplepost.app.mjs');
  assert.match(app, /Authorization: `Bearer \$\{this\.\$auth\.api_key\}`/);
  assert.match(app, /this\.\$auth\.base_url/);
  assert.match(app, /\/api\/v1\/accounts/);
});

test('create-post action exposes Scheduler post settings', () => {
  const action = source('components/actions/create-post/create-post.mjs');
  assert.match(action, /postingMode/);
  assert.match(action, /idempotencyKey/);
  assert.match(action, /repostEnabled/);
  assert.match(action, /normalizeScheduledFor\(this\.scheduledFor\)/);
  assert.match(action, /simplepost\.createPost/);
});

test('scheduled times normalize to UTC', async () => {
  const { normalizeScheduledFor } = await import('../components/common.mjs');
  assert.equal(normalizeScheduledFor('2030-01-01T14:00:00+02:00'), '2030-01-01T12:00:00.000Z');
  assert.throws(() => normalizeScheduledFor('not-a-date'), /valid date and time/);
});

test('validate-post action targets the validation endpoint', () => {
  const action = source('components/actions/validate-post/validate-post.mjs');
  assert.match(action, /simplepost\.validatePost/);
});
