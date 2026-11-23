import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";

import { createPostSchema, readCreatePostBody } from "@/lib/validations/posts";

const portal = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../../integrations/pabbly/portal.json"), "utf8"),
) as {
  accountDropdown: { url: string; responsePath: string };
  postRequest: { method: string; url: string; contentType: string };
  actions: { name: string; postingMode: "draft" | "schedule"; fields: string[] }[];
};

const values: Record<string, string> = {
  accountId: "connected-account-1",
  message: 'Approved "spring" copy\nNew arrivals + 10% off & shipping 🚀',
  idempotencyKey: "airtable:content:rec123",
  scheduledFor: "2030-05-01T14:00:00Z",
};

function formRequest(body: URLSearchParams) {
  return new Request(portal.postRequest.url, {
    method: portal.postRequest.method,
    headers: { "content-type": `${portal.postRequest.contentType}; charset=UTF-8` },
    body,
  });
}

it.each(portal.actions)("$name maps a Pabbly form to the existing post input", async ({ fields, postingMode }) => {
  const body = new URLSearchParams(fields.map((field) => [field, values[field]]));
  body.set("postingMode", postingMode);

  const result = createPostSchema.parse(await readCreatePostBody(formRequest(body)));

  expect(result).toEqual({
    accountIds: [values.accountId],
    message: values.message,
    idempotencyKey: values.idempotencyKey,
    postingMode,
    ...(postingMode === "schedule" ? { scheduledFor: values.scheduledFor } : {}),
  });
});

it.each([
  ["immediate publishing", { postingMode: "now" }],
  ["schedule without a timezone", { postingMode: "schedule", scheduledFor: "2030-05-01T14:00:00" }],
  ["schedule without a date", { postingMode: "schedule" }],
  ["an empty idempotency key", { postingMode: "draft", idempotencyKey: "" }],
])("rejects a form with %s", async (_name, fields) => {
  const body = new URLSearchParams({
    accountId: values.accountId,
    message: values.message,
    idempotencyKey: values.idempotencyKey,
  });
  for (const [key, value] of Object.entries(fields)) body.set(key, value);
  await expect(readCreatePostBody(formRequest(body))).rejects.toThrow();
});

it("preserves the existing JSON input for immediate publishing and multiple accounts", async () => {
  const post = { accountIds: ["account-1", "account-2"], message: "Hello", postingMode: "now" };
  const request = new Request(portal.postRequest.url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(post),
  });
  await expect(readCreatePostBody(request)).resolves.toEqual(post);
});

it("maps only eligible accounts to the Pabbly dropdown", () => {
  const { searchParams } = new URL(portal.accountDropdown.url);
  const template = JSON.parse(searchParams.get("pc_json_parser_template") ?? "{}");
  const expression = template[portal.accountDropdown.responsePath].slice(3, -3);
  const accounts = [
    { id: "ready", displayName: "SimplePost", platform: "x" },
    { id: "fallback", username: "publisher", platform: "bluesky", previewOnly: false },
    { id: "preview", previewOnly: true },
    { id: "expired", credentialStatus: { state: "reauth_required" } },
  ];
  expect(runInNewContext(expression, { accounts }, { timeout: 1000 })).toEqual([
    { id: "ready", label: "SimplePost (x)" },
    { id: "fallback", label: "publisher (bluesky)" },
  ]);
});
