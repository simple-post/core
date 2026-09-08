import { ExportResultCode } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BasicTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";

import { SanitizingSpanExporter } from "@/lib/observability/sanitizing-exporter";

import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

it("redacts real ended spans before export, preserving IDs, outcomes and URLs without secrets", async () => {
  const captured: ReadableSpan[] = [];
  const delegate: SpanExporter = {
    export: (spans, done) => {
      captured.push(...spans);
      done({ code: ExportResultCode.SUCCESS });
    },
    shutdown: jest.fn(async () => {}),
  };
  const provider = new BasicTracerProvider({
    resource: resourceFromAttributes({ "service.name": "test", authorization: "resource-secret" }),
    spanProcessors: [new SimpleSpanProcessor(new SanitizingSpanExporter(delegate))],
  });
  const span = provider
    .getTracer("test")
    .startSpan("GET https://api.telegram.org/bot123:bot-secret/getChat?chat_id=456");
  span.setAttributes({
    "http.url": "https://graph.instagram.com/refresh_access_token?access_token=ig-secret",
    "http.status_code": 400,
    "http.request.header.authorization": "header-secret",
    "db.statement": "SELECT 'db-secret'",
    alternatives: ["https://user:password@example.com/path?token=query-secret#fragment-secret"],
  });
  span.addEvent("exception", { "exception.message": "https://example.com/?token=event-secret" });
  span.end();
  await provider.forceFlush();
  expect(captured).toHaveLength(1);
  const output = captured[0];
  expect(output.spanContext().traceId).toBe(span.spanContext().traceId);
  expect(output.duration).toEqual(expect.arrayContaining([expect.any(Number)]));
  expect(output.ended).toBe(true);
  expect(output.droppedAttributesCount).toBe(0);
  expect(output).not.toHaveProperty("_spanProcessor");
  expect(output.attributes["http.status_code"]).toBe(400);
  expect(output.resource.attributes["service.name"]).toBe("test");
  const serialized = JSON.stringify({
    name: output.name,
    attributes: output.attributes,
    events: output.events,
    resource: output.resource.attributes,
  });
  for (const secret of [
    "bot-secret",
    "ig-secret",
    "header-secret",
    "db-secret",
    "password",
    "query-secret",
    "fragment-secret",
    "event-secret",
    "resource-secret",
  ]) {
    expect(serialized).not.toContain(secret);
  }
  await provider.shutdown();
  expect(delegate.shutdown).toHaveBeenCalled();
});
