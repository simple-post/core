import {
  AccountOptionsMapSchema,
  AccountOverridesMapSchema,
  MediaFileSchema,
  PlatformSchema,
  ThreadSchema,
  createPostSchema,
  validationRequestSchema,
} from "@simple-post/sdk";
import * as z from "zod/v4";

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

export const CreatePostRequestSchema = createPostSchema
  .extend({
    postingMode: z.literal("now").default("now"),
  })
  .meta({ id: "ServerCreatePostRequest" });

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
