export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const [{ validateEnv }, { logger, serializeError }, { registerProcessErrorHandlers }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/logger"),
    import("@/lib/logger/process"),
  ]);

  registerProcessErrorHandlers();

  try {
    validateEnv();
  } catch (error) {
    logger.fatal({ err: serializeError(error) }, "Scheduler environment validation failed");
    throw error;
  }
}
