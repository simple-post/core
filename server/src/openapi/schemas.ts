import {
  AccountOptionsMapSchema,
  PlacementResultSchema,
  AccountOverridesMapSchema,
  MediaFileSchema,
  PlatformSchema,
  ThreadSchema,
  createPostSchema,
  repostPostSchema,
  validationRequestSchema,
} from "@simple-post/sdk";
import * as z from "zod";

export const JsonValueSchema = z.unknown();

export const ApiErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: JsonValueSchema.optional(),
    message: z.string().optional(),
  })
  .meta({ id: "ServerApiError" });

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    timestamp: z.iso.datetime(),
    version: z.string(),
  })
  .meta({ id: "HealthResponse" });

export const OpenApiDocumentSchema = z
  .record(z.string(), JsonValueSchema)
  .meta({ id: "ServerOpenApiDocument", description: "Generated OpenAPI 3.1 document." });

export const MediaFileResponseSchema = MediaFileSchema.meta({ id: "ServerMediaFile" });

export const PresignUploadRequestSchema = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1),
    size: z
      .number()
      .int()
      .positive()
      .max(500 * 1024 * 1024),
  })
  .meta({ id: "ServerPresignUploadRequest" });

export const PresignUploadResponseSchema = z
  .object({
    uploadUrl: z.url(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string()),
    expiresIn: z.number().int().positive(),
    key: z.string(),
    media: MediaFileResponseSchema,
  })
  .meta({ id: "ServerPresignUploadResponse" });

export const CreatePostRequestSchema = createPostSchema
  .extend({
    postingMode: z.literal("now").default("now"),
  })
  .meta({ id: "ServerCreatePostRequest" });

export const RepostRequestSchema = repostPostSchema.meta({ id: "ServerRepostRequest" });

export const ValidationRequestSchema = validationRequestSchema.meta({ id: "ServerValidationRequest" });

export const AccountSummarySchema = z
  .object({
    id: z.string(),
    platform: z.string(),
    label: z.string().optional(),
    username: z.string().optional(),
    platformAccountId: z.string().optional(),
    profilePicture: z.url().optional(),
  })
  .meta({ id: "ServerAccountSummary" });

export const AccountsEnvelopeSchema = z
  .object({
    accounts: z.array(AccountSummarySchema),
  })
  .meta({ id: "ServerAccountsEnvelope" });

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
  .meta({ id: "ServerThreadSegmentResult" });

export const PostSchema = z
  .object({
    id: z.string(),
    message: z.string(),
    accountIds: z.array(z.string()),
    media: z.array(MediaFileResponseSchema),
    thread: ThreadSchema.optional(),
    scheduledFor: z.iso.datetime(),
    status: z.enum(["published", "failed"]),
    createdAt: z.iso.datetime(),
    publishedAt: z.iso.datetime().optional(),
    accountOptions: AccountOptionsMapSchema.optional(),
    accountOverrides: AccountOverridesMapSchema.optional(),
  })
  .meta({ id: "ServerPost" });

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
    threadResults: z.array(ThreadSegmentResultSchema).optional(),
    placementResults: z.array(PlacementResultSchema).optional(),
  })
  .meta({ id: "ServerPostingResult" });

export const PostingSummarySchema = z
  .object({
    successCount: z.number().int().nonnegative(),
    failureCount: z.number().int().nonnegative(),
    overallSuccess: z.boolean(),
  })
  .meta({ id: "ServerPostingSummary" });

export const CreatePostResponseSchema = z
  .object({
    post: PostSchema,
    postingResults: z.array(PostingResultSchema),
    summary: PostingSummarySchema,
  })
  .meta({ id: "ServerCreatePostResponse" });

export const RepostResponseSchema = z
  .object({
    repostingResults: z.array(PostingResultSchema),
    summary: PostingSummarySchema,
  })
  .meta({ id: "ServerRepostResponse" });

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
  .meta({ id: "ServerValidationIssue" });

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
        maxDurationSec: z.number().positive().optional(),
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
  .meta({ id: "ServerPlatformValidationRules" });

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
  .meta({ id: "ServerPlatformValidationResponse" });

export const ValidationResponseSchema = z
  .object({
    fittedContent: z
      .object({
        media: z.array(MediaFileSchema),
        accountOverrides: AccountOverridesMapSchema.optional(),
        accountOptions: AccountOptionsMapSchema.optional(),
        thread: ThreadSchema.optional(),
      })
      .optional()
      .describe(
        "Present when imageFit is requested. Use these reviewed media URLs and overrides when creating the post."
      ),
    platforms: z.array(PlatformSchema),
    results: z.array(PlatformValidationResponseSchema),
    summary: z.object({
      errors: z.array(ValidationIssueSchema),
      warnings: z.array(ValidationIssueSchema),
      isValid: z.boolean(),
    }),
    accounts: z.array(AccountSummarySchema),
    missingAccountIds: z.array(z.string()),
  })
  .meta({ id: "ServerValidationResponse" });

const metricNumber = z.number().optional();
const PostMetricsSchema = z
  .object({
    views: metricNumber,
    reach: metricNumber,
    likes: metricNumber,
    comments: metricNumber,
    shares: metricNumber,
    quotes: metricNumber,
    saves: metricNumber,
    clicks: metricNumber,
    profileVisits: metricNumber,
    follows: metricNumber,
    watchTimeSeconds: metricNumber,
    averageWatchTimeSeconds: metricNumber,
  })
  .describe("Comparable metrics. A missing metric is not reported by the platform; 0 means none yet.")
  .meta({ id: "ServerPostMetrics" });

const AnalyticsStatusSchema = z
  .enum(["ok", "not_found", "unsupported", "missing_permission", "rate_limited", "credentials_error", "error"])
  .describe("Whether metrics could be read for this target.");

export const AnalyticsPostsRequestSchema = z
  .object({
    targets: z
      .array(
        z.object({
          accountId: z.string().describe("Configured account that published the post."),
          postId: z.string().min(1).describe("Platform post ID returned when publishing (Bluesky: the at:// URI)."),
          uri: z.string().optional().describe("Bluesky record URI when postId is not one."),
          mediaType: z.enum(["text", "image", "video", "carousel"]).optional(),
        })
      )
      .min(1)
      .max(100),
  })
  .meta({ id: "ServerAnalyticsPostsRequest" });

export const AnalyticsPostResultSchema = z
  .object({
    accountId: z.string(),
    platform: PlatformSchema,
    postId: z.string(),
    status: AnalyticsStatusSchema,
    metrics: PostMetricsSchema,
    engagements: z.number().nullable().describe("likes + comments + shares + quotes + saves"),
    platformMetrics: z.record(z.string(), z.number()).optional(),
    url: z.string().optional(),
    publishedAt: z.string().optional(),
    resolvedPostId: z.string().optional(),
    message: z.string().optional(),
    fetchedAt: z.string(),
  })
  .meta({ id: "ServerAnalyticsPostResult" });

export const AnalyticsPostsResponseSchema = z
  .object({ results: z.array(AnalyticsPostResultSchema) })
  .meta({ id: "ServerAnalyticsPostsResponse" });

export const AnalyticsAccountsResponseSchema = z
  .object({
    accounts: z.array(
      z.object({
        accountId: z.string(),
        platform: PlatformSchema,
        status: AnalyticsStatusSchema,
        metrics: z.record(z.string(), z.number()),
        platformMetrics: z.record(z.string(), z.number()).optional(),
        message: z.string().optional(),
        fetchedAt: z.string(),
      })
    ),
  })
  .meta({ id: "ServerAnalyticsAccountsResponse" });
