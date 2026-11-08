import { afterEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  buildErrorReport,
  sendErrorReport,
  withErrorContext,
  addErrorContext,
  requestErrorContext,
  flushErrorReports,
} from "../scheduler/lib/error-reporting.ts";

const environment = { ...process.env };
afterEach(() => {
  mock.restoreAll();
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
});
function configured() {
  process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = "https://collector.example/v1/logs";
  delete process.env.OTEL_SDK_DISABLED;
  delete process.env.OTEL_LOGS_EXPORTER;
  process.env.LOG_TELEGRAM_BOT_TOKEN = "test-token";
  process.env.LOG_TELEGRAM_CHAT_ID = "test-chat";
  delete process.env.LOG_TELEGRAM_DISABLED;
}

test("readable report preserves complete sanitized stack only in structured diagnostics", () => {
  const error = new Error("Upload failed: Bearer top-secret");
  error.stack = `${error.message}\n${"    at upload (worker.ts:10:2)\n".repeat(600)}`;
  error.cause = new Error("https://user:pass@example.com/path?token=secret");
  const report = buildErrorReport("Simple Example", error, {
    area: "upload",
    userId: "u1",
    userEmail: "user@example.com",
    country: "GR",
    surface: "mcp",
    agent: "Claude",
    jobId: "job1",
    requestId: "request1",
    body: "PRIVATE CONTENT",
    token: "PRIVATE TOKEN",
  });
  for (const expected of [
    "Upload failed",
    "upload",
    "user@example.com",
    "GR",
    "mcp",
    "Claude",
    "job1",
    "request1",
    report.id,
  ])
    assert.ok(report.summary.includes(expected));
  assert.ok(!report.summary.includes("at upload"));
  assert.ok(report.attributes["exception.stacktrace"].length > 16000);
  assert.equal(report.attributes["exception.stacktrace"].split("at upload").length, 601);
  assert.ok(!JSON.stringify(report).includes("top-secret"));
  assert.ok(!JSON.stringify(report).includes("user:pass"));
  assert.ok(!JSON.stringify(report).includes("token=secret"));
  assert.ok(!JSON.stringify(report).includes("PRIVATE"));
});

test("overlapping requests never exchange users or country", async () => {
  const reports = await Promise.all(
    ["a", "b"].map((userId) =>
      withErrorContext({ userId, country: userId === "a" ? "GR" : "DE" }, async () => {
        await new Promise((resolve) => setTimeout(resolve, userId === "a" ? 10 : 1));
        addErrorContext({ userEmail: `${userId}@example.com` });
        return buildErrorReport("Simple", new Error("failed"));
      }),
    ),
  );
  assert.equal(reports[0].attributes["user.email"], "a@example.com");
  assert.equal(reports[1].attributes["user.email"], "b@example.com");
  assert.equal(reports[0].attributes["geo.country"], "GR");
  assert.equal(buildErrorReport("Simple", "outside").attributes["user.id"], undefined);
});

test("request hints classify MCP, mobile and browser without exporting headers or query secrets", () => {
  const context = requestErrorContext(
    new Headers({ "user-agent": "Claude/1", "cf-ipcountry": "GR", authorization: "Bearer secret" }),
    "/mcp?token=secret",
    "POST",
  );
  assert.equal(context.surface, "mcp");
  assert.equal(context.agent, "Claude");
  assert.equal(context.country, "GR");
  assert.equal(context.path, "/mcp");
  assert.ok(!JSON.stringify(context).includes("secret"));
  assert.equal(requestErrorContext({ "user-agent": "SimpleMuscle CFNetwork" }, "/sync").surface, "mobile");
  assert.equal(requestErrorContext({ "user-agent": "Mozilla/5.0 Chrome/123" }, "/api").surface, "web");
  assert.equal(requestErrorContext({ "cf-ipcountry": "XX" }).country, "unknown");
});

test("both destinations start independently; the same report body and full stack reach OTLP", async () => {
  configured();
  const calls = [];
  let release;
  const collector = new Promise((resolve) => {
    release = resolve;
  });
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (url.includes("collector")) await collector;
    return new Response('{"ok":true}');
  });
  const report = buildErrorReport("Simple", new Error("provider unavailable"), { userEmail: "user@example.com" });
  const delivery = sendErrorReport(report, { service: "simple" });
  assert.equal(calls.length, 2);
  const log = calls.find((call) => call.url.includes("collector")).body.resourceLogs[0].scopeLogs[0].logRecords[0];
  const telegram = calls.find((call) => call.url.includes("telegram")).body;
  assert.equal(log.body.stringValue, telegram.text);
  assert.ok(log.attributes.some((attribute) => attribute.key === "exception.stacktrace"));
  assert.equal(telegram.parse_mode, undefined);
  release();
  await delivery;
});

test("a failed sink cannot reject application work or suppress the other sink", async () => {
  configured();
  const warnings = [];
  const calls = [];
  mock.method(console, "warn", (value) => warnings.push(value));
  mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    if (url.includes("collector")) throw new Error("secret credential in transport");
    return new Response('{"ok":true}');
  });
  await sendErrorReport(buildErrorReport("Simple", "failed"), { service: "simple" });
  assert.equal(calls.filter((url) => url.includes("telegram")).length, 1);
  assert.equal(calls.filter((url) => url.includes("collector")).length, 2);
  assert.equal(warnings.length, 1);
  assert.ok(!warnings[0].includes("credential"));
});

test("all repeated internal errors alert even above the legacy rate cap", async () => {
  configured();
  process.env.LOG_TELEGRAM_MAX_PER_MINUTE = "1";
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response('{"ok":true}');
  });
  for (let i = 0; i < 12; i++)
    void sendErrorReport(buildErrorReport("Simple", new Error("same failure")), { service: "simple" });
  await flushErrorReports();
  assert.equal(calls.filter((call) => call.url.includes("telegram")).length, 12);
  assert.equal(new Set(calls.filter((call) => call.url.includes("telegram")).map((call) => call.body.text)).size, 12);
});

test("logs-only config and percent-encoded ingestion header work without a Telegram bot", async () => {
  configured();
  delete process.env.LOG_TELEGRAM_BOT_TOKEN;
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = "signoz-ingestion-key=a%3Db";
  const calls = [];
  mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    return new Response("{}");
  });
  await sendErrorReport(buildErrorReport("Simple", "failure"), { service: "simple" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["signoz-ingestion-key"], "a=b");
});

test("Telegram failure and OTLP partial rejection are visible, without recursive reports", async () => {
  configured();
  const warnings = [];
  mock.method(console, "warn", (value) => warnings.push(value));
  mock.method(
    globalThis,
    "fetch",
    async (url) =>
      new Response(url.includes("telegram") ? '{"ok":false}' : '{"partialSuccess":{"rejectedLogRecords":"1"}}'),
  );
  await sendErrorReport(buildErrorReport("Simple", "failure"), { service: "simple" });
  assert.equal(warnings.length, 2);
});

test("long summaries retain the correlation ID within Telegram limits", () => {
  const report = buildErrorReport("Simple", new Error("x".repeat(5000)), {
    area: "a".repeat(1000),
    userEmail: "u".repeat(1000),
    userId: "i".repeat(1000),
    country: "GR",
    surface: "mcp",
    agent: "Claude",
    requestId: "r".repeat(1000),
    path: "/path",
    status: 500,
    toolName: "t".repeat(1000),
    jobId: "j".repeat(1000),
    postId: "p".repeat(1000),
    platform: "x".repeat(1000),
    stage: "s".repeat(1000),
    code: "c".repeat(1000),
  });
  assert.ok(report.summary.length <= 3900);
  assert.ok(report.summary.endsWith(report.id));
  assert.equal(report.attributes["exception.message"].length, 5000);
});
