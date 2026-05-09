function getRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getBoolean(name: string): boolean {
  return process.env[name]?.toLowerCase() === "true";
}

/**
 * Validate that all critical environment variables are present.
 * Call once at startup (instrumentation.ts) to fail fast on misconfiguration.
 */
export function validateEnv(): void {
  const required = [
    "BETTER_AUTH_SECRET",
    "SCHEDULER_ENCRYPTION_KEY",
    "SCHEDULED_POST_DISPATCH_SECRET",
    "RESEND_API_KEY",
  ];

  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables:\n${missing.map((n) => `  - ${n}`).join("\n")}`);
  }
}

/** Typed accessors for critical environment variables. */
export const env = {
  get BETTER_AUTH_SECRET() {
    return getRequired("BETTER_AUTH_SECRET");
  },
  get SCHEDULER_ENCRYPTION_KEY() {
    return getRequired("SCHEDULER_ENCRYPTION_KEY");
  },
  get SCHEDULED_POST_DISPATCH_SECRET() {
    return getRequired("SCHEDULED_POST_DISPATCH_SECRET");
  },
  get RESEND_API_KEY() {
    return getRequired("RESEND_API_KEY");
  },
  get NEXT_PUBLIC_APP_URL() {
    return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  },
  get RESEND_FROM_ADDRESS() {
    return process.env.RESEND_FROM_ADDRESS || "auth@simplepost.dev";
  },
  get ENABLE_OPENAI_TEST_LOGIN() {
    return getBoolean("ENABLE_OPENAI_TEST_LOGIN");
  },
};
