import type { Instrumentation } from "next";

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
    logger.error(
      { err: serializeError(observabilityError) },
      "OpenTelemetry setup failed; continuing without telemetry",
    );
  }

  try {
    validateEnv();
  } catch (error) {
    logger.fatal({ err: serializeError(error) }, "Scheduler environment validation failed");
    throw error;
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { requestErrorContext, flushErrorReports } = await import("@/lib/error-reporting");
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers))
      if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const details: Record<string, unknown> = requestErrorContext(headers, request.path, request.method);
    try {
      const { auth } = await import("@/lib/auth/auth");
      const session = await auth.api.getSession({ headers });
      if (session) Object.assign(details, { userId: session.user.id, userEmail: session.user.email });
    } catch {
      /* Identity can be unavailable during an authentication/database outage. */
    }
    const { logger } = await import("@/lib/logger");
    logger.error({ ...details, error, area: `${context.routeType}:${context.routePath}` }, "Unhandled request error");
    await flushErrorReports();
  } catch {
    console.warn("Request error reporting failed");
  }
};
