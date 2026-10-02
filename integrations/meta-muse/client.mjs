import { pathToFileURL } from "node:url";

export const META_BASE = "https://api.meta.ai/v1";
export const SIMPLEPOST_BASE = "https://app.simplepost.social/api/v1";

export function required(env, name) {
  if (!env[name]?.trim()) throw new Error(`Set ${name}`);
  return env[name];
}

// Separate local credentials: never send a Meta key to a configurable endpoint.
export function modelSettings(env, local = false) {
  if (!local)
    return { base: META_BASE, key: required(env, "MODEL_API_KEY"), model: env.MUSE_MODEL || "muse-spark-1.3" };
  const url = new URL(required(env, "LOCAL_MODEL_BASE_URL"));
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Local model URL must be a loopback HTTP(S) endpoint without credentials or query");
  return { base: url.href.replace(/\/$/, ""), key: env.LOCAL_MODEL_API_KEY, model: required(env, "LOCAL_MODEL_NAME") };
}

export async function request(base, path, { key, body, fetchImpl = fetch, raw = false } = {}) {
  // Callers supply only fixed paths; redirects cannot forward credentials elsewhere.
  const headers = key ? { Authorization: `Bearer ${key}` } : {};
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetchImpl(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    throw new Error(
      `Request to ${new URL(base).hostname} failed; write outcome may be unknown. Do not change the idempotency key to retry.`,
    );
  }
  // Do not echo upstream bodies: they can contain user data or credentials.
  if (!response.ok) throw new Error(`Request to ${new URL(base).hostname} returned HTTP ${response.status}`);
  if (raw) return response;
  try {
    return await response.json();
  } catch {
    throw new Error("Upstream returned invalid JSON");
  }
}

export function postInput(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !["message", "accountIds"].includes(key)) ||
    typeof value.message !== "string" ||
    !value.message.trim() ||
    value.message.length > 50_000 ||
    !Array.isArray(value.accountIds) ||
    value.accountIds.length < 1 ||
    value.accountIds.length > 20 ||
    value.accountIds.some((id) => typeof id !== "string" || !id.trim() || id.length > 200) ||
    new Set(value.accountIds).size !== value.accountIds.length
  ) {
    throw new Error("Expected only message and 1–20 distinct accountIds (text-only example)");
  }
  return { message: value.message, accountIds: [...value.accountIds] };
}

export function isMain(metaUrl) {
  return process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href;
}

export async function cli(run) {
  try {
    await run();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
