import { logger, serializeError } from "@/lib/logger";

export function registerProcessErrorHandlers(): void {
  const globalState = globalThis as typeof globalThis & { __simplepostProcessLoggerRegistered?: boolean };
  if (globalState.__simplepostProcessLoggerRegistered || typeof process === "undefined") {
    return;
  }

  globalState.__simplepostProcessLoggerRegistered = true;

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    logger.fatal({ err: serializeError(error), origin }, "Uncaught exception");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error({ err: serializeError(reason) }, "Unhandled promise rejection");
  });
}
