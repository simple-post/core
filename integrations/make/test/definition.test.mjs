import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "src");
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(srcDir, relativePath), "utf8"));
const app = readJson("makecomapp.json");
const modules = Object.entries(app.components.module);
const moduleCode = (id, codeType) => readJson(app.components.module[id].codeFiles[codeType]);

// Request contracts of the Scheduler API (sdk/src/types/api.ts and
// scheduler/lib/validations/posts.ts). Update together with those schemas.
const CREATE_POST_FIELDS = new Set([
  "imageFit",
  "message",
  "accountIds",
  "postingMode",
  "scheduledFor",
  "accountOptions",
  "accountOverrides",
  "repost",
  "media",
  "thread",
  "idempotencyKey",
  "quotePostId",
]);
const VALIDATION_FIELDS = new Set([
  "imageFit",
  "message",
  "media",
  "accountIds",
  "accountOptions",
  "accountOverrides",
  "thread",
]);
const MEDIA_FILE_FIELDS = new Set(["id", "url", "thumbnailUrl", "type", "contentType", "filename", "size", "durationSec"]);
const MEDIA_FILE_REQUIRED = ["id", "url", "type", "filename", "size"];
const WEBHOOK_EVENTS = new Set(["post.published", "post.failed"]);

// Flattens mappable parameters, including parameters nested under select options,
// the way Make merges them into `parameters`.
function topLevelParameterNames(parameters) {
  return parameters.flatMap((parameter) => [
    parameter.name,
    ...(Array.isArray(parameter.options) ? parameter.options : []).flatMap((option) =>
      topLevelParameterNames(option.nested ?? []),
    ),
  ]);
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [path.relative(srcDir, full)];
  });
}

test("makecomapp.json references existing files and every source file is referenced", () => {
  const referenced = new Set(["makecomapp.json", ...Object.values(app.generalCodeFiles).filter(Boolean)]);
  for (const components of Object.values(app.components)) {
    for (const component of Object.values(components)) {
      for (const file of Object.values(component.codeFiles).filter(Boolean)) referenced.add(file);
    }
  }
  for (const file of referenced) assert.ok(fs.existsSync(path.join(srcDir, file)), `missing ${file}`);
  for (const file of listFiles(srcDir)) assert.ok(referenced.has(file), `unreferenced ${file}`);
});

test("component IDs follow the Make Apps Editor naming rules", () => {
  for (const id of [...Object.keys(app.components.module), ...Object.keys(app.components.rpc)]) {
    assert.match(id, /^[a-zA-Z][0-9a-zA-Z]{2,47}$/, id);
  }
  for (const id of [...Object.keys(app.components.connection), ...Object.keys(app.components.webhook)]) {
    assert.match(id, /^[a-zA-Z][0-9a-zA-Z-]{1,33}[0-9a-zA-Z]$/, id);
  }
  for (const origin of app.origins) {
    assert.match(origin.baseUrl, /^https:\/\/(eu|us)\d\.make\.com\/api$/);
    assert.match(origin.appId, /^[a-z][0-9a-z-]+[0-9a-z]$/);
    assert.equal(origin.apikeyFile, "../.secrets/apikey");
  }
});

test("modules and webhooks reference declared components", () => {
  for (const [id, module] of modules) {
    if (module.moduleType === "instant_trigger") {
      assert.ok(app.components.webhook[module.webhook], `${id} webhook`);
    } else {
      assert.ok(app.components.connection[module.connection], `${id} connection`);
    }
  }
  for (const webhook of Object.values(app.components.webhook)) {
    assert.ok(app.components.connection[webhook.connection]);
  }
  for (const [id, module] of modules) {
    const optionUrls = JSON.stringify(moduleCode(id, "mappableParams")).match(/rpc:\/\/\w+/g) ?? [];
    for (const url of optionUrls) assert.ok(app.components.rpc[url.slice("rpc://".length)], `${id} ${url}`);
  }
});

test("groups list every module exactly once", () => {
  const grouped = readJson(app.generalCodeFiles.groups).flatMap((group) => group.modules);
  assert.deepEqual([...grouped].sort(), Object.keys(app.components.module).sort());
});

test("module labels and descriptions follow Make naming conventions", () => {
  for (const [id, module] of modules) {
    assert.match(module.label, /^[A-Z][a-z]+( [a-z]+| API)*$/, `${id} label is sentence case`);
    assert.match(module.description, /^[A-Z].*\.$/, `${id} description`);
    if (module.moduleType === "instant_trigger") assert.match(module.label, /^Watch /);
    if (module.moduleType === "search") assert.match(module.label, /^(List|Search) /);
  }
  const universal = modules.filter(([, module]) => module.moduleType === "universal");
  assert.equal(universal.length, 1);
  assert.equal(universal[0][1].label, "Make an API call");
  assert.equal(
    universal[0][1].description,
    "Sends a custom API call to SimplePost. You can use this to call endpoints that aren't covered by existing modules.",
  );
});

test("base and connection authenticate with the API key and sanitize it", () => {
  const base = readJson(app.generalCodeFiles.base);
  assert.equal(base.baseUrl, "{{connection.baseUrl}}");
  assert.equal(base.headers.Authorization, "Bearer {{connection.apiKey}}");
  assert.deepEqual(base.log.sanitize, ["request.headers.authorization"]);
  assert.match(base.response.error.message, /^\[\{\{statusCode\}\}\]/);

  const connection = app.components.connection.simplepost.codeFiles;
  const communication = readJson(connection.communication);
  assert.equal(communication.url, "{{parameters.baseUrl}}/api/v1/accounts");
  assert.equal(communication.headers.Authorization, "Bearer {{parameters.apiKey}}");
  assert.deepEqual(communication.log.sanitize, ["request.headers.authorization"]);

  const [apiKey, baseUrl] = readJson(connection.params);
  assert.equal(apiKey.type, "password");
  assert.equal(apiKey.editable, true);
  assert.equal(baseUrl.default, "https://app.simplepost.social");
  assert.equal(baseUrl.editable, false);
  assert.equal(baseUrl.advanced, true);
});

test("every request uses a path relative to the base URL", () => {
  const requests = [
    ...modules.filter(([, module]) => module.moduleType !== "instant_trigger").map(([id]) => moduleCode(id, "communication")),
    ...Object.values(app.components.rpc).map((rpc) => readJson(rpc.codeFiles.communication)),
    ...Object.values(app.components.webhook).flatMap((webhook) => [
      readJson(webhook.codeFiles.attach),
      readJson(webhook.codeFiles.detach),
    ]),
  ];
  for (const request of requests) assert.match(request.url, /^\//, request.url);
});

test("search modules expose an optional limit as their last parameter", () => {
  for (const [id, module] of modules.filter(([, module]) => module.moduleType === "search")) {
    const parameters = moduleCode(id, "mappableParams");
    const limit = parameters.at(-1);
    assert.equal(limit.name, "limit", id);
    assert.equal(limit.type, "uinteger");
    assert.equal(limit.default, 10);
    assert.ok(!limit.required && !limit.advanced);
    assert.equal(moduleCode(id, "communication").response.limit, "{{parameters.limit}}");
  }
  const search = moduleCode("searchPosts", "communication");
  assert.equal(search.qs.limit, 100, "largest page size the API allows");
  assert.equal(search.pagination.condition, "{{body.pagination.hasNextPage}}");
});

test("create and validate modules only send fields the Scheduler API accepts", () => {
  const create = moduleCode("createPost", "mappableParams");
  for (const name of topLevelParameterNames(create)) assert.ok(CREATE_POST_FIELDS.has(name), `createPost.${name}`);
  assert.deepEqual(
    create.find((parameter) => parameter.name === "postingMode").options.map((option) => option.value),
    ["now", "schedule", "draft"],
  );

  const validate = moduleCode("validatePost", "mappableParams");
  for (const name of topLevelParameterNames(validate)) assert.ok(VALIDATION_FIELDS.has(name), `validatePost.${name}`);
});

test("media items match the Scheduler media file schema", () => {
  const mediaSpecs = [];
  const collect = (parameters) => {
    for (const parameter of parameters) {
      if (parameter.name === "media") mediaSpecs.push(parameter.spec.spec);
      if (Array.isArray(parameter.spec?.spec)) collect(parameter.spec.spec);
    }
  };
  collect(moduleCode("createPost", "mappableParams"));
  collect(moduleCode("validatePost", "mappableParams"));
  assert.equal(mediaSpecs.length, 4, "root and thread media in both modules");
  for (const spec of mediaSpecs) {
    for (const field of spec) assert.ok(MEDIA_FILE_FIELDS.has(field.name), field.name);
    for (const name of MEDIA_FILE_REQUIRED) assert.equal(spec.find((field) => field.name === name)?.required, true, name);
  }

  const uploadOutput = moduleCode("uploadMediaFile", "communication").response.output;
  for (const name of MEDIA_FILE_REQUIRED) assert.ok(uploadOutput[name], `upload output ${name}`);
});

test("instant triggers register and remove SimplePost webhooks", () => {
  for (const webhook of Object.values(app.components.webhook)) {
    const attach = readJson(webhook.codeFiles.attach);
    assert.equal(attach.method, "POST");
    assert.equal(attach.url, "/api/v1/webhooks");
    assert.equal(attach.body.url, "{{webhook.url}}");
    assert.equal(attach.body.events.length, 1);
    assert.ok(WEBHOOK_EVENTS.has(attach.body.events[0]));
    assert.equal(attach.response.data.externalHookId, "{{body.webhook.id}}");

    const detach = readJson(webhook.codeFiles.detach);
    assert.equal(detach.method, "DELETE");
    assert.equal(detach.url, "/api/v1/webhooks/{{encodeURL(webhook.externalHookId)}}");

    const communication = readJson(webhook.codeFiles.communication);
    assert.equal(communication.condition, `{{body.event = '${attach.body.events[0]}'}}`);
  }
});
