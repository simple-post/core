export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  // This must run before importing Pino or application modules so library
  // instrumentation can patch them before their first load. The heavy OTEL
  // dependency tree is only loaded when an OTLP endpoint is configured, and a
  // telemetry failure must never take the scheduler down (the logger is not
  // loaded yet, so the error is logged again below once it is).
  let observabilityError: unknown;
  try {
    const { observabilityEnabled } = await import("@/lib/observability/config");
    if (observabilityEnabled()) {
      const { registerObservability } = await import("@/lib/observability/register");
      registerObservability();
    }
  } catch (error) {
    observabilityError = error;
    console.error("OpenTelemetry setup failed; continuing without telemetry", error);
  }

  const [{ validateEnv }, { logger, serializeError }, { registerProcessErrorHandlers }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/logger"),
    import("@/lib/logger/process"),
  ]);

  registerProcessErrorHandlers();

  if (observabilityError) {
    logger.error({ err: serializeError(observabilityError) }, "OpenTelemetry setup failed; continuing without telemetry");
  }

  try {
    validateEnv();
  } catch (error) {
    logger.fatal({ err: serializeError(error) }, "Scheduler environment validation failed");
    throw error;
  }
}
