import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";

import { loadAccounts } from "./config/accounts.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import accountsRoutes from "./routes/accounts.js";
import healthRoutes from "./routes/health.js";
import mediaRoutes from "./routes/media.js";
import openApiRoutes from "./routes/openapi.js";
import postsRoutes from "./routes/posts.js";
import repostsRoutes from "./routes/reposts.js";
import uploadPresignRoutes from "./routes/upload-presign.js";
import uploadRoutes from "./routes/upload.js";
import validationRoutes from "./routes/validation.js";
import { ApiError } from "./utils/errors.js";
import { ensureStorageDir, getStorageDir } from "./utils/files.js";

const API_KEY = process.env.SIMPLE_POST_API_KEY;
const PORT = process.env.PORT || 3000;

function resolveTrustProxy(): boolean | number | string {
  const configured = process.env.TRUST_PROXY?.trim();
  if (!configured || configured === "false") return false;
  if (configured === "true") return true;
  if (/^\d+$/.test(configured)) return Number(configured);
  return configured;
}

if (!API_KEY) {
  console.error("Error: SIMPLE_POST_API_KEY environment variable is required");
  throw new Error("SIMPLE_POST_API_KEY environment variable is required");
}

try {
  const storageDir = await ensureStorageDir();
  console.log(`Storage directory initialized: ${storageDir}`);
} catch (error) {
  console.error("Error: Failed to initialize storage directory:", error);
  console.error(`Configured storage path: ${getStorageDir()}`);
  throw new Error(
    `Failed to initialize storage directory at '${getStorageDir()}'. ` +
      "Check permissions and disk space, or configure SIMPLE_POST_STORAGE_DIR environment variable."
  );
}

try {
  const accounts = await loadAccounts();
  if (accounts.length === 0) {
    console.warn(
      "No accounts configured. Set SIMPLE_POST_ACCOUNTS_FILE to a JSON file with an `accounts` array to enable posting."
    );
  } else {
    console.log(
      `Loaded ${accounts.length} account(s): ${accounts.map((a) => `${a.id} (${a.rawPlatform})`).join(", ")}`
    );
  }
} catch (error) {
  console.error("Error: Failed to load accounts file:", error);
  throw error;
}

const app = express();

// Disabled by default: trusting an unspecified proxy lets clients spoof their
// source IP through X-Forwarded-For. Operators behind a known proxy must opt in
// with a hop count, subnet, or Express trust-proxy value.
app.set("trust proxy", resolveTrustProxy());

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false, // API server does not serve browser-rendered content
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31_536_000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    referrerPolicy: { policy: "no-referrer" },
  })
);

// IP-based rate limiting
const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: Number(process.env.RATE_LIMIT_MAX_REQUESTS || 300),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many requests",
    message: "Too many requests from this IP, please try again later.",
  },
});

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RATE_LIMIT_AUTH_MAX_REQUESTS || 100),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    error: "Too many authentication attempts",
    message: "Too many authentication attempts from this IP, please try again later.",
  },
});

app.use(globalRateLimiter);

// Configure timeouts (10 minutes for long-running social media operations)
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
app.use((req, res, next) => {
  req.setTimeout(TIMEOUT_MS);
  res.setTimeout(TIMEOUT_MS);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use("/health", healthRoutes);
app.use("/openapi.json", openApiRoutes);

// Public media endpoint — platforms fetch URLs returned from /api/v1/upload here.
// No auth: filenames are random UUIDs (security through unguessable identifiers).
app.use("/media", mediaRoutes);

// Apply stricter rate limit for authenticated API usage
app.use(authRateLimiter);

// All API endpoints below require x-api-key.
app.use(createAuthMiddleware(API_KEY));

app.use("/api/v1/accounts", accountsRoutes);
app.use("/api/v1/upload/presign", uploadPresignRoutes);
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1/validation", validationRoutes);
app.use("/api/v1/posts", postsRoutes);
app.use("/api/v1/reposts", repostsRoutes);

app.use("*", (req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    res.status(status).json({ error: err.message, code: err.code });
    return;
  }
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code });
    return;
  }
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`SimplePost server running on port ${PORT}`);
  console.log(`Storage directory: ${getStorageDir()}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`OpenAPI JSON:  http://localhost:${PORT}/openapi.json`);
  console.log(`API base:     http://localhost:${PORT}/api/v1`);
});

server.timeout = TIMEOUT_MS;
server.keepAliveTimeout = TIMEOUT_MS;
server.headersTimeout = TIMEOUT_MS + 1000;

process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

export default app;
