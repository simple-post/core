import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { registerOTel } from "@vercel/otel";

import { registerObservability } from "@/lib/observability/register";

jest.mock("@vercel/otel", () => ({ registerOTel: jest.fn() }));
jest.mock("@/lib/observability/config", () => ({
  observabilityEnabled: () => true,
  signalEnabled: (signal: string) => signal === "TRACES",
}));

it("replaces auto export processors instead of adding a second, sanitized exporter", () => {
  expect(registerObservability()).toBe(true);
  const config = (registerOTel as jest.Mock).mock.calls[0][0];
  expect(config.spanProcessors).toHaveLength(1);
  expect(config.spanProcessors[0]).toBeInstanceOf(BatchSpanProcessor);
  expect(config.spanProcessors).not.toContain("auto");
  // @vercel/otel appends traceExporter to its default processors when both
  // an endpoint and a custom exporter are present, leaking an unsanitized copy.
  expect(config.traceExporter).toBeUndefined();
});
