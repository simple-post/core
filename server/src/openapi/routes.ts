import accountsRoutes from "../routes/accounts.openapi.js";
import healthRoutes from "../routes/health.openapi.js";
import mediaRoutes from "../routes/media.openapi.js";
import openApiRoutes from "../routes/openapi.openapi.js";
import postsRoutes from "../routes/posts.openapi.js";
import repostsRoutes from "../routes/reposts.openapi.js";
import uploadPresignRoutes from "../routes/upload-presign.openapi.js";
import uploadRoutes from "../routes/upload.openapi.js";
import validationRoutes from "../routes/validation.openapi.js";

import type { OpenApiRoute } from "./helpers.js";

export const serverOpenApiRoutes: OpenApiRoute[] = [
  openApiRoutes,
  healthRoutes,
  mediaRoutes,
  accountsRoutes,
  uploadRoutes,
  uploadPresignRoutes,
  validationRoutes,
  postsRoutes,
  repostsRoutes,
];
