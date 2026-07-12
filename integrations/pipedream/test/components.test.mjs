import assert from 'node:assert/strict';
import test from 'node:test';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('app source uses SimplePost bearer API-key authentication', () => {
  const app = source('components/simplepost.app.mjs');
  assert.match(app, /Authorization: `Bearer \$\{this\.apiKey\}`/);
  assert.match(app, /\/api\/v1\/accounts/);
});

test('create-post action exposes Scheduler post settings', () => {
  const action = source('components/actions/create-post/create-post.mjs');
  assert.match(action, /postingMode/);
  assert.match(action, /idempotencyKey/);
  assert.match(action, /simplepost\.createPost/);
});

test('validate-post action targets the validation endpoint', () => {
  const action = source('components/actions/validate-post/validate-post.mjs');
  assert.match(action, /simplepost\.validatePost/);
});
