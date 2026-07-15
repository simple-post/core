import { getBoolean } from "@/lib/env";

export type OtelSignal = "TRACES" | "METRICS" | "LOGS";

function hasEndpoint(signal: OtelSignal): boolean {
  return !!(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`]);
}

/**
 * A signal is exported only when an OTLP endpoint is configured for it and it
 * is not opted out via OTEL_<SIGNAL>_EXPORTER=none. Endpoint-only gating keeps
 * the documented guarantee that telemetry produces no network activity until
 * an endpoint is set (the SDK default would otherwise export to localhost).
 */
export function signalEnabled(signal: OtelSignal): boolean {
  if (process.env[`OTEL_${signal}_EXPORTER`]?.toLowerCase() === "none") {
    return false;
  }
  return hasEndpoint(signal);
}

/**
 * Cheap check used by instrumentation.ts to decide whether to load the heavy
 * OpenTelemetry dependency tree at all. This module must not import any
 * OpenTelemetry or application packages.
 */
export function observabilityEnabled(): boolean {
  if (getBoolean("OTEL_SDK_DISABLED")) {
    return false;
  }
  return signalEnabled("TRACES") || signalEnabled("METRICS") || signalEnabled("LOGS");
}
