import { resourceFromAttributes } from "@opentelemetry/resources";

import { diagnosticText } from "@/lib/logger/error-fields";
import { isSensitiveKey } from "@/lib/logger/sensitive-keys";

import type { Attributes } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

function safeAttributes(attributes: Attributes): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      isSensitiveKey(key) || key === "db.statement" || key === "db.query.text"
        ? "[REDACTED]"
        : typeof value === "string"
          ? diagnosticText(value)
          : Array.isArray(value)
            ? value.map((item) => (typeof item === "string" ? diagnosticText(item) : item))
            : value,
    ]),
  ) as Attributes;
}

/** Sanitize the export snapshot, never mutate a span shared with other processors. */
export class SanitizingSpanExporter implements SpanExporter {
  constructor(private readonly delegate: SpanExporter) {}

  export(spans: ReadableSpan[], callback: (result: ExportResult) => void): void {
    this.delegate.export(
      spans.map((span) => ({
        kind: span.kind,
        parentSpanContext: span.parentSpanContext,
        startTime: span.startTime,
        endTime: span.endTime,
        duration: span.duration,
        ended: span.ended,
        droppedAttributesCount: span.droppedAttributesCount,
        droppedEventsCount: span.droppedEventsCount,
        droppedLinksCount: span.droppedLinksCount,
        instrumentationScope: span.instrumentationScope,
        spanContext: () => span.spanContext(),
        name: diagnosticText(span.name),
        attributes: safeAttributes(span.attributes),
        status: { ...span.status, message: span.status.message && diagnosticText(span.status.message) },
        events: span.events.map((event) => ({
          ...event,
          name: diagnosticText(event.name),
          attributes: event.attributes && safeAttributes(event.attributes),
        })),
        links: span.links.map((link) => ({ ...link, attributes: link.attributes && safeAttributes(link.attributes) })),
        resource: resourceFromAttributes(safeAttributes(span.resource.attributes)),
      })),
      callback,
    );
  }

  shutdown(): Promise<void> {
    return this.delegate.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.delegate.forceFlush?.() ?? Promise.resolve();
  }
}
