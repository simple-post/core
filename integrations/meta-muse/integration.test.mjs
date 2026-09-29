import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { META_BASE, modelSettings, postInput, request, SIMPLEPOST_BASE } from "./client.mjs";
import { runAgent } from "./social-agent.mjs";
import { saveDraft } from "./save-draft.mjs";
import { imageRequest, runMedia, segmentationRequest, transcriptionForm } from "./media.mjs";

const env = {
  MODEL_API_KEY: "meta-test-key",
  SIMPLEPOST_API_KEY: "simplepost-test-key",
  SIMPLEPOST_IDEMPOTENCY_KEY: "reviewed-draft-001",
};
const input = { message: "Reviewed copy", accountIds: ["account-1"] };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const call = (name, args = {}, id = "call-1") => ({
  role: "assistant",
  content: null,
  reasoning_content: "preserved reasoning",
  tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});
const completion = (message) => json({ choices: [{ message }] });

function mock(steps) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({
        url,
        ...options,
        body: options.body instanceof FormData ? options.body : options.body ? JSON.parse(options.body) : undefined,
      });
      const step = steps.shift();
      assert.ok(step, "Unexpected network request");
      return typeof step === "function" ? step(calls.at(-1)) : step;
    },
  };
}

test("hosted/local model selection keeps Meta credentials off local endpoints", () => {
  assert.equal(modelSettings(env).model, "muse-spark-1.3");
  assert.deepEqual(
    modelSettings(
      { ...env, LOCAL_MODEL_BASE_URL: "http://127.0.0.1:8000/v1", LOCAL_MODEL_NAME: "served-glimmer" },
      true,
    ),
    { base: "http://127.0.0.1:8000/v1", key: undefined, model: "served-glimmer" },
  );
  for (const base of [
    "https://untrusted.example/v1",
    "http://user:pass@localhost/v1",
    "http://localhost/v1?key=secret",
  ]) {
    assert.throws(() => modelSettings({ LOCAL_MODEL_BASE_URL: base, LOCAL_MODEL_NAME: "test" }, true), /loopback/);
  }
});

test("tool loop executes read-only calls, redacts account data and replays complete messages", async () => {
  const listed = call("list_accounts");
  const validation = call("validate_post", input, "call-2");
  const network = mock([
    completion(listed),
    json({
      accounts: [
        {
          id: "account-1",
          platform: "x",
          displayName: "Test",
          email: "private",
          userId: "private",
          tokenMetadata: "private",
          accessToken: "secret",
          credentialStatus: { action: "none", severity: "ok", lastRefreshError: "secret" },
        },
      ],
    }),
    completion(validation),
    json({ summary: { isValid: true }, accounts: [] }),
    completion({ role: "assistant", content: "Proposed copy; not saved." }),
  ]);
  assert.equal(await runAgent("Prepare copy", { env, ...network }), "Proposed copy; not saved.");
  assert.equal(network.calls[1].url, `${SIMPLEPOST_BASE}/accounts`);
  assert.equal(network.calls[3].url, `${SIMPLEPOST_BASE}/validation`);
  assert.deepEqual(network.calls[3].body, input);
  const history = network.calls[4].body.messages;
  assert.deepEqual(history[2], listed);
  assert.equal(history[3].tool_call_id, "call-1");
  assert.deepEqual(history[4], validation);
  assert.equal(history[5].tool_call_id, "call-2");
  for (const field of ["accessToken", "email", "userId", "tokenMetadata", "lastRefreshError", "simplepost-test-key"])
    assert.ok(!JSON.stringify(history).includes(field));
  assert.equal(network.calls[0].headers.Authorization, "Bearer meta-test-key");
  assert.equal(network.calls[1].headers.Authorization, "Bearer simplepost-test-key");
});

test("invented writes and account IDs stop before any write or validation request", async () => {
  for (const name of ["publish_post", "save_draft", "delete_post"]) {
    const network = mock([completion(call(name, input))]);
    await assert.rejects(runAgent("Publish", { env, ...network }), /Unapproved tool/);
    assert.equal(network.calls.length, 1);
  }
  const network = mock([completion(call("validate_post", input))]);
  await assert.rejects(runAgent("Validate", { env, ...network }), /List accounts first/);
  assert.equal(network.calls.length, 1);
});

test("loop bounded even when the model keeps asking for allowed tools", async () => {
  const network = mock([completion(call("list_accounts")), json({ accounts: [] })]);
  await assert.rejects(runAgent("Prepare", { env, ...network, maxTurns: 1 }), /turn limit/);
});

test("malformed model output, missing credentials and invalid tool args fail closed", async () => {
  await assert.rejects(runAgent("", { env }), /non-empty/);
  await assert.rejects(runAgent("Prepare", { env: {} }), /MODEL_API_KEY/);
  await assert.rejects(runAgent("Prepare", { env, ...mock([json({})]) }), /no assistant/);
  await assert.rejects(
    runAgent("Prepare", { env, ...mock([completion(call("list_accounts", { key: "not-allowed" }))]) }),
    /no arguments/,
  );
});

test("local tool loop uses a local model but still hosted SimplePost, without Meta bearer", async () => {
  const network = mock([completion({ role: "assistant", content: "Proposal" })]);
  await runAgent("Prepare", {
    env: { ...env, LOCAL_MODEL_BASE_URL: "http://localhost:8000/v1", LOCAL_MODEL_NAME: "glimmer" },
    local: true,
    ...network,
  });
  assert.equal(network.calls[0].url, "http://localhost:8000/v1/chat/completions");
  assert.deepEqual(network.calls[0].headers, { "Content-Type": "application/json" });
});

test("draft save requires explicit opt-in, exact payload and a retained key", async () => {
  await assert.rejects(saveDraft(input, { env }), /--save-draft/);
  await assert.rejects(saveDraft({ ...input, postingMode: "now" }, { confirmed: true, env }), /Expected only/);
  await assert.rejects(saveDraft(input, { confirmed: true, env: { SIMPLEPOST_API_KEY: "test" } }), /IDEMPOTENCY_KEY/);
  const network = mock([
    json({ accounts: [{ id: "account-1" }] }),
    json({ summary: { isValid: true } }),
    json({ post: { id: "draft-1", status: "draft" } }),
  ]);
  assert.deepEqual(await saveDraft(input, { confirmed: true, env, ...network }), { id: "draft-1", status: "draft" });
  assert.deepEqual(network.calls[2].body, { ...input, postingMode: "draft", idempotencyKey: "reviewed-draft-001" });
});

test("invalid targets and failed validation never create drafts", async () => {
  const missing = mock([json({ accounts: [] })]);
  await assert.rejects(saveDraft(input, { confirmed: true, env, ...missing }), /Unknown target/);
  assert.equal(missing.calls.length, 1);
  const invalid = mock([json({ accounts: [{ id: "account-1" }] }), json({ summary: { isValid: false } })]);
  await assert.rejects(saveDraft(input, { confirmed: true, env, ...invalid }), /Validation failed/);
  assert.equal(invalid.calls.length, 2);
});

test("uncertain writes fail without automatic retries; deliberate retry preserves key", async () => {
  const network = mock([
    json({ accounts: [{ id: "account-1" }] }),
    json({ summary: { isValid: true } }),
    () => {
      throw new Error("secret upstream error");
    },
  ]);
  await assert.rejects(saveDraft(input, { confirmed: true, env, ...network }), /outcome may be unknown/);
  assert.equal(network.calls.length, 3);
  const replay = mock([
    json({ accounts: [{ id: "account-1" }] }),
    json({ summary: { isValid: true } }),
    json({ post: { id: "same-draft", status: "draft" } }),
  ]);
  await saveDraft(input, { confirmed: true, env, ...replay });
  assert.equal(network.calls[2].body.idempotencyKey, replay.calls[2].body.idempotencyKey);
});

test("network errors are sanitized, and redirects are rejected", async () => {
  const network = mock([json({ error: "secret" }, 401)]);
  await assert.rejects(
    request(META_BASE, "/responses", { key: "secret", ...network }),
    (error) => !error.message.includes("secret") && error.message.includes("401"),
  );
  assert.equal(network.calls[0].redirect, "error");
  await assert.rejects(
    request(META_BASE, "/responses", { fetchImpl: async () => new Response("private invalid JSON") }),
    /invalid JSON/,
  );
});

test("text-only input rejects media transforms and invalid targets", () => {
  for (const value of [
    null,
    [],
    { ...input, imageFit: {} },
    { ...input, media: [] },
    { ...input, accountIds: [] },
    { ...input, accountIds: ["a", "a"] },
    { ...input, message: " " },
  ])
    assert.throws(() => postInput(value));
});

function wav() {
  const bytes = Buffer.alloc(46);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(38, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(2, 40);
  return bytes;
}

test("image, voice and SAM request shapes match their distinct APIs", () => {
  const image = imageRequest("Launch", "data:image/png;base64,test");
  assert.equal(image.model, "muse-image-1.0");
  assert.equal(image.tools[0].output_format, "png");
  assert.equal(image.tools[0].enable_web_search, false);
  assert.equal(image.input[0].content[1].type, "input_image");
  const sam = segmentationRequest("bottle", "https://example.com/image.png");
  assert.equal(sam.model, "sam-3.1");
  assert.equal(sam.stream, true);
  assert.equal(sam.input[0].content[0].text, "bottle");
  assert.throws(() => segmentationRequest("bottle", "http://example.com/image.png"));
  const form = transcriptionForm(wav());
  assert.deepEqual(JSON.parse(form.get("request")), {
    mode: "DIARIZATION",
    model: "muse-voice-transcribe-1.0",
    audioEncoding: "WAV",
  });
  assert.equal(form.get("audio").type, "audio/wav");
  const invalid = wav();
  invalid.writeUInt16LE(2, 22);
  assert.throws(() => transcriptionForm(invalid), /mono/);
  assert.throws(() => transcriptionForm(Buffer.from("not wav")), /WAV/);
});

test("media commands save inspected formats, preserve outputs, and never call SimplePost", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "simplepost-muse-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const imageFile = join(directory, "image.png");
  const network = mock([json({ output: [{ type: "image_generation_call", result: png.toString("base64") }] })]);
  await runMedia(["image", "Launch", imageFile], { env, ...network });
  assert.deepEqual(await readFile(imageFile), png);
  await assert.rejects(runMedia(["image", "Launch", imageFile], { env, ...network }), /EEXIST/);
  assert.equal(network.calls.length, 1);
  assert.equal(network.calls[0].url, `${META_BASE}/responses`);
  const audioFile = join(directory, "audio.wav"),
    transcriptFile = join(directory, "transcript.json");
  await writeFile(audioFile, wav());
  const voice = mock([json({ transcript: "Reviewed words", turns: [] })]);
  await runMedia(["transcribe", audioFile, transcriptFile], { env, ...voice });
  assert.equal(JSON.parse(await readFile(transcriptFile, "utf8")).transcript, "Reviewed words");
  assert.equal(voice.calls[0].url, `${META_BASE}/asr/transcribe`);
  assert.ok(!voice.calls[0].headers["Content-Type"], "fetch sets multipart boundary");
  const samFile = join(directory, "mask.sse"),
    event = 'event: response.output_text.delta\ndata: {"delta":"mask"}\n\n';
  const sam = mock([new Response(event, { headers: { "content-type": "text/event-stream" } })]);
  await runMedia(["segment", "https://example.com/image.png", samFile, "bottle"], { env, ...sam });
  assert.equal(await readFile(samFile, "utf8"), event);
  assert.equal(sam.calls[0].body.input[0].content[0].text, "bottle");
});

test("install snippet targets hosted OAuth MCP without embedded credentials", async () => {
  const settings = JSON.parse(await readFile(new URL("./muse-code-settings.json", import.meta.url), "utf8"));
  assert.deepEqual(settings, {
    mcp_servers: {
      simplepost: {
        transport: "streamable_http",
        url: "https://app.simplepost.social/mcp",
        enabled: true,
        mode: "optional",
      },
    },
  });
});
