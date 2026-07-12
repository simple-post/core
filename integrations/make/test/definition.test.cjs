const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const definitionRoot = path.join(__dirname, '..', 'definition');

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(definitionRoot, relativePath), 'utf8'));

test('Make manifest references every shipped module', () => {
  const manifest = readJson('manifest.json');
  assert.equal(manifest.name, 'SimplePost');
  assert.deepEqual(manifest.modules, [
    'modules/create-post.json',
    'modules/list-accounts.json',
    'modules/validate-post.json',
  ]);
  manifest.modules.forEach((modulePath) => assert.ok(fs.existsSync(path.join(definitionRoot, modulePath))));
});

test('base uses the SimplePost bearer API key', () => {
  const base = readJson('base.json');
  assert.equal(base.baseUrl, '{{connection.baseUrl}}');
  assert.equal(base.headers.Authorization, 'Bearer {{connection.apiKey}}');
});

test('create post module targets the Scheduler posts API', () => {
  const module = readJson('modules/create-post.json');
  assert.equal(module.communication.url, '/api/v1/posts');
  assert.equal(module.communication.method, 'POST');
  assert.ok(module.mappableParameters.some((parameter) => parameter.name === 'idempotencyKey'));
});
