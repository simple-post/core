import {
  AccountOptionsMapSchema,
  AccountOverridesMapSchema,
  MediaFileSchema,
  PlatformSchema,
  RepostSettingsSchema,
  ThreadSchema,
  validationRequestSchema,
} from "@simple-post/sdk";
import * as z from "zod";

import { postingSlotSchema, postingSlotsRequestSchema } from "@/lib/posting-slots/settings";
import { createPostSchema, updatePostSchema } from "@/lib/validations/posts";

export const JsonValueSchema = z.unknown();

export const ApiErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: JsonValueSchema.optional(),
    message: z.string().optional(),
  })
  .meta({ id: "ApiError" });

export const OAuthErrorSchema = z
  .object({
    error: z.string(),
    error_description: z.string().optional(),
  })
  .meta({ id: "OAuthError" });

export const SuccessSchema = z
  .object({
    success: z.boolean(),
  })
  .meta({ id: "Success" });

export const MediaFileResponseSchema = MediaFileSchema.meta({ id: "MediaFile" });

export const CreatePostRequestSchema = createPostSchema.meta({ id: "CreatePostRequest" });

export const RepostSettingsRequestSchema = RepostSettingsSchema.meta({ id: "RepostSettingsRequest" });

export const RepostSettingsEnvelopeSchema = z
  .object({
    settings: RepostSettingsSchema,
  })
  .meta({ id: "RepostSettingsEnvelope" });

export const PostingSlotSchema = postingSlotSchema.meta({ id: "PostingSlot" });

export const PostingSlotsRequestSchema = postingSlotsRequestSchema.meta({ id: "PostingSlotsRequest" });

export const PostingSlotsEnvelopeSchema = z
  .object({
    slots: z.array(PostingSlotSchema),
  })
  .meta({ id: "PostingSlotsEnvelope" });

export const UpdatePostRequestSchema = updatePostSchema.meta({ id: "UpdatePostRequest" });

export const ValidationRequestSchema = validationRequestSchema.meta({ id: "ValidationRequest" });

export const PaginationSchema = z
  .object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  })
  .meta({ id: "Pagination" });

export const ThreadSegmentResultSchema = z
  .object({
    index: z.number().int().nonnegative(),
    success: z.boolean(),
    postId: z.string().optional(),
    postUrl: z.url().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    details: JsonValueSchema.optional(),
  })
  .meta({ id: "ThreadSegmentResult" });

export const PostSchema = z
  .object({
    id: z.string(),
    message: z.string(),
    accountIds: z.array(z.string()),
    media: z.array(MediaFileResponseSchema),
    scheduledFor: z.iso.datetime().nullable(),
    status: z.enum(["draft", "scheduled", "pending", "published", "failed"]),
    errorMessage: z.string().optional(),
    errorDetails: z.record(z.string(), JsonValueSchema).optional(),
    createdAt: z.iso.datetime(),
    publishedAt: z.iso.datetime().optional(),
    accountOptions: AccountOptionsMapSchema.optional(),
    accountOverrides: AccountOverridesMapSchema.optional(),
    repostEnabled: z.boolean().optional(),
    repostDelayHours: z.number().int().positive().optional(),
    repostDueAt: z.iso.datetime().nullable().optional(),
    repostStatus: z.enum(["not_applicable", "scheduled", "pending", "completed", "failed"]).optional(),
    repostedAt: z.iso.datetime().nullable().optional(),
    repostResults: z.record(z.string(), JsonValueSchema).nullable().optional(),
    repostErrorMessage: z.string().optional(),
    repostErrorDetails: z.record(z.string(), JsonValueSchema).optional(),
    thread: ThreadSchema.optional(),
    threadResults: z.record(z.string(), z.array(ThreadSegmentResultSchema)).optional(),
    accountResults: z.record(z.string(), JsonValueSchema).nullable().optional(),
    quotePostId: z.string().nullable().optional(),
  })
  .meta({ id: "Post" });

export const PostEnvelopeSchema = z
  .object({
    post: PostSchema,
  })
  .meta({ id: "PostEnvelope" });

export const PostsEnvelopeSchema = z
  .object({
    posts: z.array(PostSchema),
    pagination: PaginationSchema.optional(),
  })
  .meta({ id: "PostsEnvelope" });

export const PostCountsEnvelopeSchema = z
  .object({
    counts: z.object({
      drafts: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      past: z.number().int().nonnegative(),
      scheduled: z.number().int().nonnegative(),
    }),
    latestFailedAt: z.iso.datetime().nullable(),
  })
  .meta({ id: "PostCountsEnvelope" });

export const PostingResultSchema = z
  .object({
    accountId: z.string(),
    platform: z.string(),
    success: z.boolean(),
    error: z.string().optional(),
    message: z.string().optional(),
    postId: z.string().optional(),
    postUrl: z.url().optional(),
    details: JsonValueSchema.optional(),
    platformData: z.record(z.string(), JsonValueSchema).optional(),
    threadResults: z.array(ThreadSegmentResultSchema).optional(),
  })
  .meta({ id: "PostingResult" });

export const PostingSummarySchema = z
  .object({
    successCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    overallSuccess: z.boolean(),
  })
  .meta({ id: "PostingSummary" });

export const CreatePostResponseSchema = z
  .object({
    post: PostSchema,
    postingResults: z.array(PostingResultSchema).optional(),
    summary: PostingSummarySchema.optional(),
  })
  .meta({ id: "CreatePostResponse" });

export const ManualRepostPostRequestSchema = z
  .object({
    accountIds: z.array(z.string()).min(1).optional(),
  })
  .meta({ id: "ManualRepostPostRequest" });

export const RepostPostResponseSchema = z
  .object({
    post: PostSchema.nullable(),
    repostingResults: z.array(PostingResultSchema),
    summary: PostingSummarySchema,
  })
  .meta({ id: "RepostPostResponse" });

export const ConnectedAccountSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    platform: z.string(),
    platformAccountId: z.string(),
    tokenType: z.string().nullable().optional(),
    expiresAt: z.iso.datetime().nullable().optional(),
    scope: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
    displayName: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    profilePicture: z.url().nullable().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    credentialStatus: z
      .object({
        action: z.enum(["none", "refresh", "reconnect"]),
        canRefresh: z.boolean(),
        expiresAt: z.iso.datetime().nullable(),
        label: z.string(),
        lastRefreshAttemptAt: z.iso.datetime().nullable(),
        lastRefreshError: z.string().nullable(),
        message: z.string(),
        refreshTokenExpiresAt: z.iso.datetime().nullable(),
        severity: z.enum(["ok", "warning", "error"]),
        state: z.enum([
          "healthy",
          "non_expiring",
          "refreshing_soon",
          "refresh_unavailable",
          "reauth_required",
          "unknown",
        ]),
      })
      .optional(),
  })
  .meta({ id: "ConnectedAccount" });

export const AccountsEnvelopeSchema = z
  .object({
    accounts: z.array(ConnectedAccountSchema),
  })
  .meta({ id: "AccountsEnvelope" });

export const ApiKeySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    keyPrefix: z.string(),
    active: z.boolean(),
    lastUsedAt: z.iso.datetime().nullable().optional(),
    revokedAt: z.iso.datetime().nullable().optional(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "ApiKey" });

export const ApiKeysEnvelopeSchema = z
  .object({
    keys: z.array(ApiKeySchema),
  })
  .meta({ id: "ApiKeysEnvelope" });

export const CreateApiKeyRequestSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
  })
  .meta({ id: "CreateApiKeyRequest" });

export const CreateApiKeyResponseSchema = z
  .object({
    apiKey: z.string(),
    key: ApiKeySchema,
  })
  .meta({ id: "CreateApiKeyResponse" });

export const DeactivateApiKeyResponseSchema = z
  .object({
    success: z.boolean(),
    key: ApiKeySchema,
  })
  .meta({ id: "DeactivateApiKeyResponse" });

export const RotateApiKeyResponseSchema = z
  .object({
    apiKey: z.string(),
    key: ApiKeySchema,
    rotatedFromId: z.string(),
  })
  .meta({ id: "RotateApiKeyResponse" });

export const DisconnectAccountResponseSchema = z
  .object({
    success: z.boolean(),
    message: z.string(),
  })
  .meta({ id: "DisconnectAccountResponse" });

export const PinterestBoardSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    pinCount: z.number().int().nonnegative(),
  })
  .meta({ id: "PinterestBoard" });

export const PinterestBoardsEnvelopeSchema = z
  .object({
    boards: z.array(PinterestBoardSchema),
  })
  .meta({ id: "PinterestBoardsEnvelope" });

export const TikTokCreatorInfoSchema = z
  .object({
    creatorAvatarUrl: z.url().nullable(),
    creatorUsername: z.string().nullable(),
    creatorNickname: z.string().nullable(),
    privacyLevelOptions: z.array(
      z.enum(["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]),
    ),
    commentDisabled: z.boolean(),
    duetDisabled: z.boolean(),
    stitchDisabled: z.boolean(),
    maxVideoPostDurationSec: z.number().nonnegative().nullable(),
    canPost: z.boolean(),
    blockReason: z.string().nullable(),
    errorCode: z.string().nullable(),
    fetchedAt: z.iso.datetime(),
  })
  .meta({ id: "TikTokCreatorInfo" });

export const TikTokCreatorInfoEnvelopeSchema = z
  .object({
    creatorInfo: TikTokCreatorInfoSchema,
  })
  .meta({ id: "TikTokCreatorInfoEnvelope" });

export const ValidationIssueSchema = z
  .object({
    platform: z.union([PlatformSchema, z.literal("common")]),
    severity: z.enum(["error", "warning"]),
    code: z.string(),
    message: z.string(),
    field: z.string().optional(),
    limit: z.number().optional(),
    actual: z.number().optional(),
    meta: z.record(z.string(), JsonValueSchema).optional(),
  })
  .meta({ id: "ValidationIssue" });

export const PlatformValidationRulesSchema = z
  .object({
    text: z
      .object({
        maxLength: z.number().int().positive().optional(),
        standardMaxLength: z.number().int().positive().optional(),
        maxCaptionLength: z.number().int().positive().optional(),
        maxCaptionLengthByMediaType: z
          .object({
            image: z.number().int().positive().optional(),
            video: z.number().int().positive().optional(),
          })
          .optional(),
      })
      .optional(),
    media: z
      .object({
        requiresMedia: z.boolean().optional(),
        minCount: z.number().int().nonnegative().optional(),
        maxCount: z.number().int().nonnegative().optional(),
        maxImages: z.number().int().nonnegative().optional(),
        maxVideos: z.number().int().nonnegative().optional(),
        allowsMixed: z.boolean().optional(),
      })
      .optional(),
    video: z
      .object({
        requiresVideo: z.boolean().optional(),
        maxSizeBytes: z.number().int().positive().optional(),
        maxTitleLength: z.number().int().positive().optional(),
        maxDescriptionLength: z.number().int().positive().optional(),
      })
      .optional(),
    image: z
      .object({
        maxSizeBytes: z.number().int().positive().optional(),
      })
      .optional(),
    notes: z.array(z.string()).optional(),
  })
  .meta({ id: "PlatformValidationRules" });

export const PlatformValidationResponseSchema = z
  .object({
    accountId: z.string(),
    platform: PlatformSchema,
    rules: PlatformValidationRulesSchema,
    errors: z.array(ValidationIssueSchema),
    warnings: z.array(ValidationIssueSchema),
    isValid: z.boolean(),
    usesCommonContent: z.boolean(),
  })
  .meta({ id: "PlatformValidationResponse" });

export const ValidationResponseSchema = z
  .object({
    platforms: z.array(PlatformSchema),
    results: z.array(PlatformValidationResponseSchema),
    summary: z.object({
      errors: z.array(ValidationIssueSchema),
      warnings: z.array(ValidationIssueSchema),
      isValid: z.boolean(),
    }),
    accounts: z.array(ConnectedAccountSchema),
  })
  .meta({ id: "ValidationResponse" });

export const SchedulerUploadResponseSchema = z
  .object({
    url: z.url(),
    key: z.string(),
    filename: z.string(),
    size: z.number().int().nonnegative(),
    type: z.string(),
  })
  .meta({ id: "SchedulerUploadResponse" });

export const PresignUploadRequestSchema = z
  .object({
    filename: z.string().min(1),
    contentType: z.string().min(1),
    size: z
      .number()
      .int()
      .positive()
      .max(500 * 1024 * 1024),
    isThumbnail: z.boolean().optional(),
  })
  .meta({ id: "PresignUploadRequest" });

export const PresignUploadResponseSchema = z
  .object({
    uploadUrl: z.url(),
    publicUrl: z.url(),
    key: z.string(),
    expiresIn: z.number().int().positive(),
  })
  .meta({ id: "PresignUploadResponse" });

export const CliAuthorizeRequestSchema = z
  .object({
    state: z.string(),
    redirectUri: z.url(),
  })
  .meta({ id: "CliAuthorizeRequest" });

export const CliTokenExchangeRequestSchema = z
  .object({
    code: z.string().min(1),
    redirect_uri: z.url(),
  })
  .meta({ id: "CliTokenExchangeRequest" });

export const CliTokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive(),
    user: z.object({
      id: z.string(),
      email: z.email(),
      name: z.string(),
    }),
  })
  .meta({ id: "CliTokenResponse" });

export const RedirectUrlResponseSchema = z
  .object({
    redirectUrl: z.url(),
  })
  .meta({ id: "RedirectUrlResponse" });

export const TelegramConnectRequestSchema = z
  .object({
    botToken: z.string(),
    chatId: z.string(),
    channelName: z.string().optional(),
  })
  .meta({ id: "TelegramConnectRequest" });

export const TelegramConnectResponseSchema = z
  .object({
    success: z.boolean(),
    account: z.object({
      platform: z.literal("telegram"),
      chatId: z.string(),
      botUsername: z.string(),
      chatTitle: z.string(),
    }),
  })
  .meta({ id: "TelegramConnectResponse" });

export const MastodonConnectRequestSchema = z
  .object({
    instanceUrl: z.url(),
    accessToken: z.string().min(1),
  })
  .meta({ id: "MastodonConnectRequest" });

export const MastodonConnectResponseSchema = z
  .object({ success: z.literal(true) })
  .meta({ id: "MastodonConnectResponse" });

export const PendingConnectionAccountSchema = z
  .object({
    id: z.string(),
    name: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
    profilePicture: z.url().nullable().optional(),
  })
  .meta({ id: "PendingConnectionAccount" });

export const PendingConnectionResponseSchema = z
  .object({
    id: z.string(),
    platform: z.string(),
    accounts: z.array(PendingConnectionAccountSchema),
  })
  .meta({ id: "PendingConnectionResponse" });

export const SelectPendingConnectionRequestSchema = z
  .object({
    selectedAccountIds: z.array(z.string()).min(1),
  })
  .meta({ id: "SelectPendingConnectionRequest" });

export const SelectPendingConnectionResponseSchema = z
  .object({
    success: z.boolean(),
    count: z.number().int().nonnegative(),
  })
  .meta({ id: "SelectPendingConnectionResponse" });

export const OAuthAuthorizeRequestSchema = z
  .object({
    client_id: z.string(),
    redirect_uri: z.url(),
    state: z.string(),
    code_challenge: z.string(),
    code_challenge_method: z.literal("S256").optional(),
    scope: z.string().optional(),
    resource: z.string().optional(),
  })
  .meta({ id: "OAuthAuthorizeRequest" });

export const OAuthRegisterRequestSchema = z
  .object({
    client_name: z.string().optional(),
    software_id: z.string().optional(),
    redirect_uris: z.array(z.url()).min(1),
    token_endpoint_auth_method: z.enum(["client_secret_post", "none"]).optional(),
    scope: z.string().optional(),
  })
  .meta({ id: "OAuthRegisterRequest" });

export const OAuthRegisterResponseSchema = z
  .object({
    client_id: z.string(),
    client_secret: z.string().optional(),
    client_name: z.string(),
    redirect_uris: z.array(z.url()),
    grant_types: z.array(z.literal("authorization_code")),
    response_types: z.array(z.literal("code")),
    token_endpoint_auth_method: z.enum(["client_secret_post", "none"]),
    scope: z.string(),
  })
  .meta({ id: "OAuthRegisterResponse" });

export const OAuthTokenRequestSchema = z
  .object({
    grant_type: z.literal("authorization_code"),
    code: z.string(),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
    redirect_uri: z.url(),
    code_verifier: z.string(),
    resource: z.string().optional(),
  })
  .meta({ id: "OAuthTokenRequest" });

export const OAuthTokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.literal("Bearer"),
    expires_in: z.number().int().positive(),
    scope: z.string(),
  })
  .meta({ id: "OAuthTokenResponse" });

export const OAuthRevokeRequestSchema = z
  .object({
    token: z.string(),
    token_type_hint: z.literal("access_token").optional(),
    client_id: z.string().optional(),
    client_secret: z.string().optional(),
  })
  .meta({ id: "OAuthRevokeRequest" });

export const WebhookEventSchema = z.enum(["post.published", "post.failed"]).meta({ id: "WebhookEvent" });

export const WebhookEndpointSchema = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(WebhookEventSchema),
    active: z.boolean(),
    lastSuccessAt: z.iso.datetime().nullable(),
    lastFailureAt: z.iso.datetime().nullable(),
    lastError: z.string().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "WebhookEndpoint" });

export const WebhooksEnvelopeSchema = z
  .object({
    webhooks: z.array(WebhookEndpointSchema),
  })
  .meta({ id: "WebhooksEnvelope" });

export const CreateWebhookRequestSchema = z
  .object({
    url: z.string().min(1),
    events: z.array(WebhookEventSchema).min(1).optional(),
  })
  .meta({ id: "CreateWebhookRequest" });

export const CreateWebhookResponseSchema = z
  .object({
    webhook: WebhookEndpointSchema.extend({
      secret: z.string().describe("HMAC-SHA256 signing secret. Returned only once - store it immediately."),
    }),
  })
  .meta({ id: "CreateWebhookResponse" });

export const UpdateWebhookRequestSchema = z
  .object({
    url: z.string().min(1).optional(),
    events: z.array(WebhookEventSchema).min(1).optional(),
    active: z.boolean().optional(),
  })
  .meta({ id: "UpdateWebhookRequest" });

export const WebhookSuccessResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .meta({ id: "WebhookSuccessResponse" });

export const DispatchScheduledPostsResponseSchema = z
  .object({
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    processedPosts: z.number().int().nonnegative(),
    publishedPosts: z.number().int().nonnegative(),
    failedPosts: z.number().int().nonnegative(),
    skippedPosts: z.number().int().nonnegative(),
    staleRecoveredPosts: z.number().int().nonnegative(),
    credentialRefresh: z.object({
      checked: z.number().int().nonnegative(),
      refreshed: z.number().int().nonnegative(),
      failed: z.number().int().nonnegative(),
      skipped: z.number().int().nonnegative(),
    }),
    processedReposts: z.number().int().nonnegative(),
    completedReposts: z.number().int().nonnegative(),
    failedReposts: z.number().int().nonnegative(),
    skippedReposts: z.number().int().nonnegative(),
    staleRecoveredReposts: z.number().int().nonnegative(),
    platformSummary: z.array(
      z.object({
        platform: z.string(),
        sent: z.number().int().nonnegative(),
        availableSlots: z.number().int().nonnegative(),
        queued: z.number().int().nonnegative(),
        rateLimit: z.object({
          maxPosts: z.number().int().positive(),
          intervalMinutes: z.number().int().positive(),
        }),
      }),
    ),
    postResults: z.array(
      z.object({
        postId: z.string(),
        success: z.boolean(),
        status: z.enum(["published", "failed"]),
        errorMessage: z.string().optional(),
      }),
    ),
    repostResults: z.array(
      z.object({
        postId: z.string(),
        success: z.boolean(),
        status: z.enum(["published", "failed"]),
        errorMessage: z.string().optional(),
      }),
    ),
  })
  .meta({ id: "DispatchScheduledPostsResponse" });

export const McpJsonRpcRequestSchema = z
  .record(z.string(), JsonValueSchema)
  .meta({ id: "McpJsonRpcRequest", description: "MCP Streamable HTTP JSON-RPC request." });

export const McpJsonRpcResponseSchema = z
  .record(z.string(), JsonValueSchema)
  .meta({ id: "McpJsonRpcResponse", description: "MCP Streamable HTTP JSON-RPC response." });

export const OpenApiDocumentSchema = z
  .record(z.string(), JsonValueSchema)
  .meta({ id: "OpenApiDocument", description: "Generated OpenAPI 3.1 document." });
