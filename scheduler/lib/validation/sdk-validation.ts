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
} from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { mapPlatformName } from "@/lib/utils/platforms";
import type { AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type { Content, Media, Platform, ValidationResult, PlatformValidationRules } from "@simple-post/sdk";

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
}): Promise<ValidationResultByPlatform> {
  const accounts = await prisma.connectedAccount.findMany({
    where: {
      userId: params.userId,
      id: { in: params.accountIds },
    },
  });

  const platforms = [...new Set(accounts.map((account) => mapPlatformName(account.platform)))] as Platform[];
  const overrides = params.accountOverrides || {};

  const results: PlatformValidationResponse[] = accounts.map((account) => {
    const platform = mapPlatformName(account.platform);
    const override = overrides[account.id];
    const usesCommonContent = !override;
    const content = buildContent(override?.message ?? params.message ?? "", override?.media ?? params.media ?? []);
    const validation: ValidationResult = validateContent(platform, content);

    const withAccountMeta = (issue: ValidationResult["errors"][number]) => ({
      ...issue,
      meta: {
        ...issue.meta,
        accountId: account.id,
      },
    });

    return {
      accountId: account.id,
      platform,
      rules: getValidationRules(platform),
      errors: validation.errors.map((issue) => withAccountMeta(issue)),
      warnings: validation.warnings.map((issue) => withAccountMeta(issue)),
      isValid: validation.isValid,
      usesCommonContent,
    };
  });

  const errors = results.flatMap((result) => result.errors);
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
