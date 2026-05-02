import express from "express";

import { loadAccounts } from "./config/accounts.js";
import { createAuthMiddleware } from "./middleware/auth.js";
import accountsRoutes from "./routes/accounts.js";
import mediaRoutes from "./routes/media.js";
import postsRoutes from "./routes/posts.js";
import uploadRoutes from "./routes/upload.js";
import validationRoutes from "./routes/validation.js";
import { ensureStorageDir, getStorageDir } from "./utils/files.js";

const API_KEY = process.env.SIMPLE_POST_API_KEY;
const PORT = process.env.PORT || 3000;

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

const TIMEOUT_MS = 10 * 60 * 1000;
app.use((req, res, next) => {
  req.setTimeout(TIMEOUT_MS);
  res.setTimeout(TIMEOUT_MS);
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "unknown",
  });
});

// Public media endpoint — platforms fetch URLs returned from /api/v1/upload here.
// No auth: filenames are random UUIDs (security through unguessable identifiers).
app.use("/media", mediaRoutes);

// All API endpoints below require x-api-key.
app.use(createAuthMiddleware(API_KEY));

app.use("/api/v1/accounts", accountsRoutes);
app.use("/api/v1/upload", uploadRoutes);
app.use("/api/v1/validation", validationRoutes);
app.use("/api/v1/posts", postsRoutes);

app.use("*", (req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

const server = app.listen(PORT, () => {
  console.log(`SimplePost server running on port ${PORT}`);
  console.log(`Storage directory: ${getStorageDir()}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
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
