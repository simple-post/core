import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "components", "simplepost");

function componentFiles(kind) {
  const dir = path.join(appDir, kind);
  return fs
    .readdirSync(dir)
    .filter((name) => name !== "common")
    .map((name) => path.join(dir, name, `${name}.mjs`));
}

const actions = componentFiles("actions");
const sources = componentFiles("sources");

test("the app follows the registry layout", async () => {
  const { default: app } = await import(path.join(appDir, "simplepost.app.mjs"));
  assert.equal(app.type, "app");
  assert.equal(app.app, "simplepost");

  const pkg = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "@pipedream/simplepost");
  assert.equal(pkg.main, "simplepost.app.mjs");
  assert.ok(pkg.dependencies["@pipedream/platform"]);

  const readme = fs.readFileSync(path.join(appDir, "README.md"), "utf8");
  for (const heading of ["# Overview", "# Example Use Cases", "# Getting Started", "# Troubleshooting"]) {
    assert.ok(readme.includes(`${heading}\n`), `README is missing ${heading}`);
  }

  for (const [name, prop] of Object.entries(app.propDefinitions)) {
    assert.ok(prop.label, `${name} needs a label`);
    assert.match(prop.description, /e\.g\. `/, `${name} needs an example`);
  }
});

for (const file of [...actions, ...sources]) {
  const relative = path.relative(appDir, file);
  const slug = path.basename(file, ".mjs");

  test(`${relative} meets the component guidelines`, async () => {
    const { default: component } = await import(file);
    const isAction = relative.startsWith("actions");

    assert.equal(component.key, `simplepost-${slug}`);
    assert.equal(component.version, "0.0.1");
    assert.equal(component.type, isAction ? "action" : "source");
    assert.match(component.description, /\[See the documentation\]\(https:\/\/docs\.simplepost\.social\//);

    const [firstProp] = Object.values(component.props);
    assert.equal(firstProp.type, "app");
    assert.equal(firstProp.app, "simplepost");

    if (isAction) {
      assert.deepEqual(Object.keys(component.annotations).sort(), ["destructiveHint", "openWorldHint", "readOnlyHint"]);
      assert.equal(component.annotations.openWorldHint, true);
      assert.equal(component.annotations.destructiveHint, false);
    } else {
      assert.equal(component.annotations, undefined, "sources must not declare annotations");
      assert.match(component.name, /^New .+ \(Instant\)$/);
      assert.match(component.description, /^Emit new event /);
      assert.equal(component.dedupe, "unique");
      assert.ok(component.sampleEmit?.post?.id);
    }
  });
}

test("read-only actions are annotated as read-only", async () => {
  const readOnly = new Set(["get-post", "list-accounts", "validate-post"]);
  for (const file of actions) {
    const { default: action } = await import(file);
    assert.equal(action.annotations.readOnlyHint, readOnly.has(path.basename(file, ".mjs")), action.key);
  }
});
