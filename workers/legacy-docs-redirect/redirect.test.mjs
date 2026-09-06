import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./src/index.mjs";

test("old docs links preserve paths and queries at the HTTPS canonical origin", () => {
  for (const path of [
    "/",
    "/mcp",
    "/api-reference?api=server&from=old",
    "/a%20b/x%2Fy?q=show_post_preview&q=api%20key",
    "//outside.example/path",
  ]) {
    for (const protocol of ["http:", "https:"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = worker.fetch(new Request(`${protocol}//docs.simplepost.dev${path}`, { method }));
        assert.equal(response.status, 308);
        assert.equal(response.headers.get("Location"), `https://docs.simplepost.social${path}`);
      }
    }
  }
});
test("the canonical and unrelated hosts do not loop or redirect", () => {
  for (const host of ["docs.simplepost.social", "example.com"]) {
    const response = worker.fetch(new Request(`https://${host}/mcp`));
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Location"), null);
  }
});
