import {
  BlueskyPublisher,
  FacebookPublisher,
  InstagramPublisher,
  LinkedInPublisher,
  PinterestPublisher,
  TelegramPublisher,
  ThreadsPublisher,
  TikTokPublisher,
  XPublisher,
  YouTubePublisher,
} from "@simple-post/sdk";

import { getAccountsByIds, type ConfiguredAccount } from "../config/accounts.js";

import type {
  AccountOverridesMap,
  Content,
  Media,
  MediaFile,
  Platform,
  PlatformValidationRules,
  ValidationResult,
} from "@simple-post/sdk";

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

function buildContent(message: string, mediaFiles: MediaFile[]): Content {
  const media: Media[] = mediaFiles.map((file) =>
    file.type === "image"
      ? { type: "image", url: file.url }
      : { type: "video", url: file.url, thumbnailUrl: file.thumbnailUrl }
  );

  return {
    text: message ?? "",
    media: media.length > 0 ? media : undefined,
  };
}

function getValidationRules(platform: Platform): PlatformValidationRules {
  return publishers[platform]?.getValidationRules() ?? {};
}

function validateContent(platform: Platform, content: Content): ValidationResult {
  return publishers[platform]?.validate(content) ?? { errors: [], warnings: [], isValid: true };
}

interface AccountSummary {
  id: string;
  platform: string;
  username?: string;
  platformAccountId?: string;
  label?: string;
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
  accounts: AccountSummary[];
  missingAccountIds: string[];
}

function summarize(account: ConfiguredAccount): AccountSummary {
  return {
    id: account.id,
    platform: account.rawPlatform,
    username: account.username,
    platformAccountId: account.platformAccountId,
    label: account.label,
  };
}

export function validatePostForAccounts(params: {
  message: string;
  media: MediaFile[];
  accountIds: string[];
  accountOverrides?: AccountOverridesMap;
}): ValidationResultByPlatform {
  const accounts = getAccountsByIds(params.accountIds);
  const foundIds = new Set(accounts.map((a) => a.id));
  const missingAccountIds = params.accountIds.filter((id) => !foundIds.has(id));

  const platforms = [...new Set(accounts.map((account) => account.platform))];
  const overrides = params.accountOverrides || {};

  const results: PlatformValidationResponse[] = accounts.map((account) => {
    const override = overrides[account.id];
    const usesCommonContent = !override;
    const content = buildContent(override?.message ?? params.message ?? "", override?.media ?? params.media ?? []);
    const validation = validateContent(account.platform, content);

    const withAccountMeta = (issue: ValidationResult["errors"][number]) => ({
      ...issue,
      meta: { ...issue.meta, accountId: account.id },
    });

    return {
      accountId: account.id,
      platform: account.platform,
      rules: getValidationRules(account.platform),
      errors: validation.errors.map((issue) => withAccountMeta(issue)),
      warnings: validation.warnings.map((issue) => withAccountMeta(issue)),
      isValid: validation.isValid,
      usesCommonContent,
    };
  });

  const errors = results.flatMap((r) => r.errors);
  const warnings = results.flatMap((r) => r.warnings);

  return {
    platforms,
    results,
    summary: { errors, warnings, isValid: errors.length === 0 },
    accounts: accounts.map((account) => summarize(account)),
    missingAccountIds,
  };
}
