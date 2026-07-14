// Deterministic env for unit tests. The encryption key is a fixed 32-byte
// hex value used only in tests.
process.env.SCHEDULER_ENCRYPTION_KEY = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret";
process.env.SCHEDULED_POST_DISPATCH_SECRET = "test-dispatch-secret";
process.env.RESEND_API_KEY = "test-resend-key";
process.env.LOG_LEVEL = "silent";
// Most existing tests exercise provider behavior rather than feature gating.
// Individual feature-flag tests call the pure parser with explicit values.
process.env.NEXT_PUBLIC_ENABLED_SOCIAL_PROVIDERS = "*";
// Keep pino on the JSON (non-pretty) path. NODE_ENV is typed read-only in
// Next.js, hence the defineProperty.
Object.defineProperty(process.env, "NODE_ENV", { value: "production", writable: true });
