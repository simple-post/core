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
import type { AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type { Content, Media, Platform, ValidationResult, PlatformValidationRules } from "@simple-post/sdk";

const PLATFORM_MAP: Record<string, Platform> = {
  x: "x",
  twitter: "x",
  youtube: "youtube",
  telegram: "telegram",
  facebook: "facebook",
  instagram: "instagram",
  tiktok: "tiktok",
  bluesky: "bluesky",
  threads: "threads",
  linkedin: "linkedin",
  pinterest: "pinterest",
};

const mapPlatformName = (platform: string): Platform => {
  return PLATFORM_MAP[platform.toLowerCase()] || (platform.toLowerCase() as Platform);
};

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

function getValidationRules(platform: Platform): PlatformValidationRules {
  switch (platform) {
    case "x": {
      return XPublisher.getValidationRules();
    }
    case "facebook": {
      return FacebookPublisher.getValidationRules();
    }
    case "instagram": {
      return InstagramPublisher.getValidationRules();
    }
    case "telegram": {
      return TelegramPublisher.getValidationRules();
    }
    case "tiktok": {
      return TikTokPublisher.getValidationRules();
    }
    case "youtube": {
      return YouTubePublisher.getValidationRules();
    }
    case "bluesky": {
      return BlueskyPublisher.getValidationRules();
    }
    case "threads": {
      return ThreadsPublisher.getValidationRules();
    }
    case "linkedin": {
      return LinkedInPublisher.getValidationRules();
    }
    case "pinterest": {
      return PinterestPublisher.getValidationRules();
    }
    default: {
      return {};
    }
  }
}

function validateContent(platform: Platform, content: Content): ValidationResult {
  switch (platform) {
    case "x": {
      return XPublisher.validate(content);
    }
    case "facebook": {
      return FacebookPublisher.validate(content);
    }
    case "instagram": {
      return InstagramPublisher.validate(content);
    }
    case "telegram": {
      return TelegramPublisher.validate(content);
    }
    case "tiktok": {
      return TikTokPublisher.validate(content);
    }
    case "youtube": {
      return YouTubePublisher.validate(content);
    }
    case "bluesky": {
      return BlueskyPublisher.validate(content);
    }
    case "threads": {
      return ThreadsPublisher.validate(content);
    }
    case "linkedin": {
      return LinkedInPublisher.validate(content);
    }
    case "pinterest": {
      return PinterestPublisher.validate(content);
    }
    default: {
      return { errors: [], warnings: [], isValid: true };
    }
  }
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
