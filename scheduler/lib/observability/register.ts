import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { PinoInstrumentation } from "@opentelemetry/instrumentation-pino";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { PrismaInstrumentation } from "@prisma/instrumentation";
import { registerOTel } from "@vercel/otel";

import { observabilityEnabled, signalEnabled } from "@/lib/observability/config";

const DEFAULT_SERVICE_NAME = "simplepost-scheduler";

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function configureDiagnostics(): void {
  const configuredLevel = process.env.OTEL_LOG_LEVEL?.toLowerCase();
  if (configuredLevel === "none") {
    return;
  }

  const levels: Record<string, DiagLogLevel> = {
    all: DiagLogLevel.ALL,
    debug: DiagLogLevel.DEBUG,
    error: DiagLogLevel.ERROR,
    info: DiagLogLevel.INFO,
    verbose: DiagLogLevel.VERBOSE,
    warn: DiagLogLevel.WARN,
  };

  // Default to error-level diagnostics: OTLP export failures are reported only
  // through diag, so without a logger a misconfigured endpoint fails silently.
  diag.setLogger(new DiagConsoleLogger(), levels[configuredLevel ?? "error"] ?? DiagLogLevel.ERROR);
}

/**
 * Registers all server-side signals with the standard OpenTelemetry SDK.
 * Nothing is exported until an OTLP endpoint is configured (see config.ts).
 */
export function registerObservability(): boolean {
  const globalState = globalThis as typeof globalThis & { __simplepostOtelRegistered?: boolean };
  if (globalState.__simplepostOtelRegistered || !observabilityEnabled()) {
    return false;
  }

  const tracesEnabled = signalEnabled("TRACES");
  const metricsEnabled = signalEnabled("METRICS");
  const logsEnabled = signalEnabled("LOGS");

  configureDiagnostics();

  const metricExportInterval = positiveInteger(process.env.OTEL_METRIC_EXPORT_INTERVAL, 60_000);
  const metricExportTimeout = Math.min(
    positiveInteger(process.env.OTEL_METRIC_EXPORT_TIMEOUT, 10_000),
    metricExportInterval,
  );
  const metricReaders = metricsEnabled
    ? [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter(),
          exportIntervalMillis: metricExportInterval,
          exportTimeoutMillis: metricExportTimeout,
          cardinalityLimits: { default: 200 },
        }),
      ]
    : [];

  const logRecordProcessors = logsEnabled ? [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })] : [];

  const environment = process.env.OTEL_DEPLOYMENT_ENVIRONMENT || process.env.NODE_ENV || "development";

  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME || DEFAULT_SERVICE_NAME,
    attributes: {
      // Both keys: SigNoz environment filtering reads the legacy attribute,
      // deployment.environment.name is the current semantic convention.
      "deployment.environment": environment,
      "deployment.environment.name": environment,
      ...(process.env.OTEL_SERVICE_VERSION && { "service.version": process.env.OTEL_SERVICE_VERSION }),
    },
    // Library instrumentation is gated per signal: with traces off, patching
    // Prisma/fetch would only create spans that are sampled, recorded, and
    // discarded, while leaking sampled traceparent headers downstream.
    instrumentations: [
      ...(tracesEnabled ? (["auto", new PrismaInstrumentation()] as const) : []),
      ...(tracesEnabled || logsEnabled ? [new PinoInstrumentation({ disableLogSending: !logsEnabled })] : []),
    ],
    // With traces disabled an empty processor list alone still records spans
    // via the default always-on sampler; always_off keeps them non-recording.
    ...(tracesEnabled ? {} : { spanProcessors: [], traceSampler: "always_off" }),
    metricReaders,
    logRecordProcessors,
  });

  // Only mark as registered on success so a throw above can be retried.
  globalState.__simplepostOtelRegistered = true;
  return true;
}
