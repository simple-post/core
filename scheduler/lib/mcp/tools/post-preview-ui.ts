import { normalizePreviewPlatform } from "@simple-post/preview";
import { AccountIdsSchema } from "@simple-post/sdk";
import { z } from "zod";

import { PostsModel } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import type { AccountOptionsMap, AccountOverridesMap, MediaFile, SocialPost, ThreadSegment } from "@/types";

import { mcpMediaArraySchema, mcpThreadSchema, toMediaFiles, toThreadSegments } from "./media-schema";

export const showPostPreviewSchema = z.object({
  postId: z
    .string()
    .min(1)
    .optional()
    .describe("Saved SimplePost post ID. When provided, the saved post is the authoritative preview source."),
  message: z
    .string()
    .optional()
    .describe(
      "Proposed post text when previewing content that has not been saved yet. Ignored when postId is provided.",
    ),
  accountIds: AccountIdsSchema.optional().describe(
    "Connected account IDs for an unsaved preview. Use list_accounts first. Ignored when postId is provided.",
  ),
  media: mcpMediaArraySchema
    .optional()
    .describe("Optional media for an unsaved preview. Ignored when postId is provided."),
  thread: mcpThreadSchema,
});

const previewMediaSchema = z.object({
  id: z.string(),
  type: z.enum(["image", "video"]),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  filename: z.string().nullable(),
});

const previewThreadSchema = z.object({
  message: z.string(),
  media: z.array(previewMediaSchema),
});

const renderedPlatformPreviewSchema = z.object({
  accountId: z.string(),
  platform: z.string(),
  platformLabel: z.string(),
  accountLabel: z.string(),
  data: z.object({
    platform: z.string(),
    account: z.object({
      id: z.string(),
      platform: z.string(),
      displayName: z.string(),
      username: z.string().nullable(),
      profilePicture: z.string().nullable(),
    }),
    message: z.string(),
    media: z.array(previewMediaSchema),
    options: z.record(z.string(), z.unknown()),
    thread: z.array(previewThreadSchema),
    previewDate: z.string(),
  }),
});

export const showPostPreviewOutputSchema = z.object({
  kind: z.literal("post_preview"),
  postId: z.string().nullable(),
  status: z.enum(["preview", "draft", "scheduled", "pending", "published", "failed"]),
  scheduledFor: z.string().nullable(),
  message: z.string(),
  previews: z.array(renderedPlatformPreviewSchema),
  summary: z.object({
    accountCount: z.number(),
    platformCount: z.number(),
    mediaCount: z.number(),
    threadSegmentCount: z.number(),
  }),
});

type PreviewAccount = {
  id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  profilePicture: string | null;
};

type PreviewSource = {
  postId: string | null;
  status: z.infer<typeof showPostPreviewOutputSchema>["status"];
  scheduledFor: Date | null;
  message: string;
  media: MediaFile[];
  thread: ThreadSegment[];
  accountIds: string[];
  accountOptions: AccountOptionsMap;
  accountOverrides: AccountOverridesMap;
};

const PLATFORM_LABELS: Record<string, string> = {
  bluesky: "Bluesky",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  telegram: "Telegram",
  threads: "Threads",
  tiktok: "TikTok",
  x: "X",
  youtube: "YouTube",
};

function platformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

function accountLabel(account: PreviewAccount): string {
  if (account.displayName?.trim()) return account.displayName;
  if (account.username?.trim()) return `@${account.username.replace(/^@/, "")}`;
  return platformLabel(account.platform);
}

function toPreviewMedia(media: MediaFile[]) {
  return media.map((file) => ({
    id: file.id,
    type: file.type,
    url: file.url,
    thumbnailUrl: file.thumbnailUrl ?? null,
    filename: file.filename || null,
  }));
}

function toPreviewThread(thread: ThreadSegment[]) {
  return thread.map((segment) => ({
    message: segment.message,
    media: toPreviewMedia(segment.media ?? []),
  }));
}

function savedPreviewSource(post: SocialPost): PreviewSource {
  const status =
    post.status === "draft" ||
    post.status === "scheduled" ||
    post.status === "pending" ||
    post.status === "published" ||
    post.status === "failed"
      ? post.status
      : "preview";
  return {
    postId: post.id,
    status,
    scheduledFor: post.scheduledFor,
    message: post.message,
    media: post.media,
    thread: post.thread ?? [],
    accountIds: post.accountIds,
    accountOptions: post.accountOptions ?? {},
    accountOverrides: post.accountOverrides ?? {},
  };
}

async function resolveSource(userId: string, input: z.infer<typeof showPostPreviewSchema>): Promise<PreviewSource> {
  if (input.postId) {
    const post = await new PostsModel(userId).getPostById(input.postId);
    if (!post) {
      throw new Error("Couldn't find that SimplePost post.");
    }
    return savedPreviewSource(post);
  }

  if (typeof input.message !== "string" || !input.accountIds?.length) {
    throw new Error("Provide either postId or both message and accountIds to show a post preview.");
  }

  return {
    postId: null,
    status: "preview",
    scheduledFor: null,
    message: input.message,
    media: toMediaFiles(input.media),
    thread: toThreadSegments(input.thread),
    accountIds: [...new Set(input.accountIds)],
    accountOptions: {},
    accountOverrides: {},
  };
}

export async function showPostPreview(
  userId: string,
  input: z.infer<typeof showPostPreviewSchema>,
): Promise<z.infer<typeof showPostPreviewOutputSchema>> {
  const source = await resolveSource(userId, input);
  const accounts = await prisma.connectedAccount.findMany({
    where: { userId, id: { in: source.accountIds } },
    select: {
      id: true,
      platform: true,
      username: true,
      displayName: true,
      profilePicture: true,
    },
  });
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const orderedAccounts = source.accountIds
    .map((accountId) => accountById.get(accountId))
    .filter((account): account is PreviewAccount => account !== undefined);

  if (orderedAccounts.length !== source.accountIds.length) {
    throw new Error("One or more preview accounts are missing or no longer connected.");
  }

  const seenPlatforms = new Set<string>();
  const previewDate = source.scheduledFor ?? new Date();
  const previews: z.infer<typeof renderedPlatformPreviewSchema>[] = [];

  for (const account of orderedAccounts) {
    const platform = normalizePreviewPlatform(account.platform);
    if (!platform || seenPlatforms.has(platform)) continue;
    seenPlatforms.add(platform);

    const override = source.accountOverrides[account.id];
    const message = override?.message ?? source.message;
    const media = override?.media ?? source.media;
    const thread = override?.thread ?? source.thread;
    const options = (source.accountOptions[account.id] ?? {}) as Record<string, unknown>;

    previews.push({
      accountId: account.id,
      platform,
      platformLabel: platformLabel(platform),
      accountLabel: accountLabel(account),
      data: {
        platform,
        account: {
          id: account.id,
          platform,
          displayName: accountLabel(account),
          username: account.username,
          profilePicture: account.profilePicture,
        },
        message,
        media: toPreviewMedia(media),
        options,
        thread: toPreviewThread(thread),
        previewDate: previewDate.toISOString(),
      },
    });
  }

  if (previews.length === 0) {
    throw new Error("None of the selected platforms currently support visual previews.");
  }

  return {
    kind: "post_preview",
    postId: source.postId,
    status: source.status,
    scheduledFor: source.scheduledFor?.toISOString() ?? null,
    message: source.message,
    previews,
    summary: {
      accountCount: orderedAccounts.length,
      platformCount: previews.length,
      mediaCount: source.media.length,
      threadSegmentCount: source.thread.length,
    },
  };
}
