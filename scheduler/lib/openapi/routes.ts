import authRoutes from "@/app/api/auth/[...all]/openapi";
import cliAuthorizeRoutes from "@/app/api/cli/authorize/openapi";
import cliTokenRoutes from "@/app/api/cli/token/openapi";
import connectPlatformRoutes from "@/app/api/connect/[platform]/openapi";
import connectCallbackRoutes from "@/app/api/connect/callback/[platform]/openapi";
import connectForemRoutes from "@/app/api/connect/forem/openapi";
import connectPendingRoutes from "@/app/api/connect/pending/[id]/openapi";
import connectTelegramRoutes from "@/app/api/connect/telegram/openapi";
import internalDispatchRoutes from "@/app/api/internal/scheduled-posts/dispatch/openapi";
import oauthAuthorizeRoutes from "@/app/api/oauth/authorize/openapi";
import oauthRegisterRoutes from "@/app/api/oauth/register/openapi";
import oauthRevokeRoutes from "@/app/api/oauth/revoke/openapi";
import oauthTokenRoutes from "@/app/api/oauth/token/openapi";
import openApiRoutes from "@/app/api/openapi.json/openapi";
import accountAvatarRoutes from "@/app/api/v1/accounts/[id]/avatar/openapi";
import accountBoardsRoutes from "@/app/api/v1/accounts/[id]/boards/openapi";
import accountRoutes from "@/app/api/v1/accounts/[id]/openapi";
import accountTikTokCreatorInfoRoutes from "@/app/api/v1/accounts/[id]/tiktok/creator-info/openapi";
import accountsRoutes from "@/app/api/v1/accounts/openapi";
import apiKeyRoute from "@/app/api/v1/api-keys/[id]/openapi";
import apiKeyRotateRoutes from "@/app/api/v1/api-keys/[id]/rotate/openapi";
import apiKeyRoutes from "@/app/api/v1/api-keys/openapi";
import postingSlotsRoutes from "@/app/api/v1/posting-slots/openapi";
import postRoutes from "@/app/api/v1/posts/[id]/openapi";
import repostPostRoutes from "@/app/api/v1/posts/[id]/repost/openapi";
import postsCalendarRoutes from "@/app/api/v1/posts/calendar/openapi";
import postsRoutes from "@/app/api/v1/posts/openapi";
import repostSettingsRoutes from "@/app/api/v1/repost-settings/openapi";
import uploadRoutes from "@/app/api/v1/upload/openapi";
import uploadPresignRoutes from "@/app/api/v1/upload/presign/openapi";
import validationRoutes from "@/app/api/v1/validation/openapi";
import webhookRoute from "@/app/api/v1/webhooks/[id]/openapi";
import webhooksRoutes from "@/app/api/v1/webhooks/openapi";
import mcpRoutes from "@/app/mcp/openapi";

import type { OpenApiRoute } from "./helpers";

export const schedulerOpenApiRoutes: OpenApiRoute[] = [
  openApiRoutes,
  authRoutes,
  cliAuthorizeRoutes,
  cliTokenRoutes,
  connectPlatformRoutes,
  connectCallbackRoutes,
  connectPendingRoutes,
  connectForemRoutes,
  connectTelegramRoutes,
  internalDispatchRoutes,
  oauthAuthorizeRoutes,
  oauthRegisterRoutes,
  oauthRevokeRoutes,
  oauthTokenRoutes,
  accountsRoutes,
  accountRoutes,
  accountAvatarRoutes,
  accountBoardsRoutes,
  accountTikTokCreatorInfoRoutes,
  apiKeyRoutes,
  apiKeyRoute,
  apiKeyRotateRoutes,
  postsRoutes,
  postRoutes,
  postsCalendarRoutes,
  repostPostRoutes,
  repostSettingsRoutes,
  postingSlotsRoutes,
  uploadRoutes,
  uploadPresignRoutes,
  validationRoutes,
  webhooksRoutes,
  webhookRoute,
  mcpRoutes,
];
