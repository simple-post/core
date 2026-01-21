import express from "express";

import { createAuthMiddleware } from "./middleware/auth.js";
import fileRoutes from "./routes/files.js";
import postRoutes from "./routes/post.js";
import { ensureStorageDir, getStorageDir } from "./utils/files.js";

const API_KEY = process.env.SIMPLE_POST_API_KEY;
const PORT = process.env.PORT || 3000;

// Validate required environment variables
if (!API_KEY) {
  console.error("Error: SIMPLE_POST_API_KEY environment variable is required");
  throw new Error("SIMPLE_POST_API_KEY environment variable is required");
}

// Ensure storage directory exists at startup (fail fast on configuration issues)
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

const app = express();

// Configure timeouts (10 minutes for long-running social media operations)
const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
app.use((req, res, next) => {
  req.setTimeout(TIMEOUT_MS);
  res.setTimeout(TIMEOUT_MS);
  next();
});

// Basic middleware
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));

// Health check endpoint (no auth required)
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "unknown",
  });
});

// Apply authentication middleware to all routes except health check
app.use(createAuthMiddleware(API_KEY));

// API routes
app.use("/post", postRoutes);
app.use("/files", fileRoutes);

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// Global error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);

  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`SimplePost server running on port ${PORT}`);
  console.log(`Storage directory: ${getStorageDir()}`);
  console.log(`Health check available at: http://localhost:${PORT}/health`);
  console.log(`API endpoint available at: http://localhost:${PORT}/post`);
  console.log(`File upload endpoint available at: http://localhost:${PORT}/files`);
});

// Configure server timeout
server.timeout = TIMEOUT_MS;
server.keepAliveTimeout = TIMEOUT_MS;
server.headersTimeout = TIMEOUT_MS + 1000; // Slightly higher than server timeout

// Graceful shutdown
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
