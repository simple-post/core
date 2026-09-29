import { readFile } from "node:fs/promises";
import { cli, isMain, postInput, request, required, SIMPLEPOST_BASE } from "./client.mjs";

// This is intentionally not a model tool. The human reviews the file first.
export async function saveDraft(value, { confirmed = false, env = process.env, fetchImpl = fetch } = {}) {
  if (!confirmed) throw new Error("Review exact copy and targets, then pass --save-draft");
  const input = postInput(value);
  const key = required(env, "SIMPLEPOST_API_KEY");
  const idempotencyKey = required(env, "SIMPLEPOST_IDEMPOTENCY_KEY");
  if (idempotencyKey.length > 200) throw new Error("Idempotency key is too long");
  const api = (path, body) => request(SIMPLEPOST_BASE, path, { key, body, fetchImpl });
  const { accounts } = await api("/accounts");
  if (!Array.isArray(accounts) || input.accountIds.some((id) => !accounts.some((account) => account.id === id)))
    throw new Error("Unknown target account");
  const validation = await api("/validation", input);
  if (validation.summary?.isValid !== true)
    throw new Error("Validation failed; inspect the same content in SimplePost before saving");
  const result = await api("/posts", { ...input, postingMode: "draft", idempotencyKey });
  if (!result.post?.id || result.post.status !== "draft")
    throw new Error("Unexpected save result; inspect SimplePost before retrying with the SAME key");
  return { id: result.post.id, status: result.post.status };
}

if (isMain(import.meta.url))
  await cli(async () => {
    const [file, flag, extra] = process.argv.slice(2);
    if (!file || flag !== "--save-draft" || extra)
      throw new Error("Usage: node save-draft.mjs reviewed-post.json --save-draft");
    console.log(
      JSON.stringify(await saveDraft(JSON.parse(await readFile(file, "utf8")), { confirmed: true }), null, 2),
    );
  });
