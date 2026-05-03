import {
  XPublisher,
  FacebookPublisher,
  InstagramPublisher,
  TelegramPublisher,
  TikTokPublisher,
  YouTubePublisher,
  BlueskyPublisher,
  ThreadsPublisher,
  LinkedInPublisher,
  PinterestPublisher,
  isThreadCapable,
} from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { mapPlatformName } from "@/lib/utils/platforms";
import type { AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type {
  Content,
  Media,
  Platform,
  ThreadSegment,
  ValidationResult,
  PlatformValidationRules,
} from "@simple-post/sdk";

const buildContent = (message: string, mediaFiles: MediaFile[]): Content => {
  const media: Media[] = mediaFiles.map((file) =>
    file.type === "image"
      ? {
          type: "image",
          url: file.url,
        }
      : {
          type: "video",
          url: file.url,
          thumbnailUrl: file.thumbnailUrl,
        },
  );

  return {
    text: message ?? "",
    media: media.length > 0 ? media : undefined,
  };
};

const publishers: Record<
  string,
  { getValidationRules: () => PlatformValidationRules; validate: (content: Content) => ValidationResult }
> = {
  x: XPublisher,
  facebook: FacebookPublisher,
  instagram: InstagramPublisher,
  telegram: TelegramPublisher,
  tiktok: TikTokPublisher,
  youtube: YouTubePublisher,
  bluesky: BlueskyPublisher,
  threads: ThreadsPublisher,
  linkedin: LinkedInPublisher,
  pinterest: PinterestPublisher,
};

function getValidationRules(platform: Platform): PlatformValidationRules {
  return publishers[platform]?.getValidationRules() ?? {};
}

function validateContent(platform: Platform, content: Content): ValidationResult {
  return publishers[platform]?.validate(content) ?? { errors: [], warnings: [], isValid: true };
}

export interface PlatformValidationResponse {
  accountId: string;
  platform: Platform;
  rules: PlatformValidationRules;
  errors: ValidationResult["errors"];
  warnings: ValidationResult["warnings"];
  isValid: boolean;
  usesCommonContent: boolean;
}

export interface ValidationSummary {
  errors: ValidationResult["errors"];
  warnings: ValidationResult["warnings"];
  isValid: boolean;
}

export interface ValidationResultByPlatform {
  platforms: Platform[];
  results: PlatformValidationResponse[];
  summary: ValidationSummary;
  accounts: ConnectedAccount[];
}

export async function validatePostForAccounts(params: {
  userId: string;
  message: string;
  media: MediaFile[];
  accountIds: string[];
  accountOverrides?: AccountOverridesMap;
  thread?: ThreadSegment[];
}): Promise<ValidationResultByPlatform> {
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      userId: params.userId,
      id: { in: params.accountIds },
    },
  });

  const platforms = [...new Set(accounts.map((account) => mapPlatformName(account.platform)))] as Platform[];
  const overrides = params.accountOverrides || {};
  const sharedThread = params.thread ?? [];

  const results: PlatformValidationResponse[] = accounts.map((account) => {
    const platform = mapPlatformName(account.platform);
    const override = overrides[account.id];
    const usesCommonContent = !override;
    const rootContent = buildContent(
      override?.message ?? params.message ?? "",
      override?.media ?? params.media ?? [],
    );

    const accountThread = override?.thread ?? sharedThread;
    const threadAware = isThreadCapable(platform);
    const segments: Array<{ field: string; content: Content }> = [{ field: "text", content: rootContent }];

    if (threadAware) {
      accountThread.forEach((segment, index) => {
        segments.push({
          field: `thread[${index}]`,
          content: buildContent(segment.message ?? "", segment.media ?? []),
        });
      });
    }

    const errors: ValidationResult["errors"] = [];
    const warnings: ValidationResult["warnings"] = [];

    for (const { field, content } of segments) {
      const validation = validateContent(platform, content);
      const withMeta = (issue: ValidationResult["errors"][number]) => ({
        ...issue,
        field: issue.field === "text" ? field : `${field}.${issue.field}`,
        meta: { ...issue.meta, accountId: account.id },
      });
      validation.errors.forEach((issue) => errors.push(withMeta(issue)));
      validation.warnings.forEach((issue) => warnings.push(withMeta(issue)));
    }

    if (!threadAware && accountThread.length > 0) {
      warnings.push({
        platform,
        severity: "warning",
        code: "thread_not_supported",
        message: `${platform} does not support threads — only the first post will be sent.`,
        field: "thread",
        meta: { accountId: account.id },
      });
    }

    return {
      accountId: account.id,
      platform,
      rules: getValidationRules(platform),
      errors,
      warnings,
      isValid: errors.length === 0,
      usesCommonContent,
    };
  });

  const anyThread = sharedThread.length > 0 || Object.values(overrides).some((o) => (o.thread ?? []).length > 0);
  const anyThreadCapable = accounts.some((account) => isThreadCapable(mapPlatformName(account.platform)));
  const crossAccountErrors: ValidationResult["errors"] = [];
  if (anyThread && !anyThreadCapable) {
    crossAccountErrors.push({
      platform: "common",
      severity: "error",
      code: "no_thread_capable_accounts",
      message: "No selected accounts support threads. Remove the additional posts or add a thread-capable account.",
      field: "thread",
    });
  }

  const errors = [...results.flatMap((result) => result.errors), ...crossAccountErrors];
  const warnings = results.flatMap((result) => result.warnings);

  return {
    platforms,
    results,
    summary: {
      errors,
      warnings,
      isValid: errors.length === 0,
    },
    accounts,
  };
}
