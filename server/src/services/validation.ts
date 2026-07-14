import {
  BlueskyPublisher,
  FacebookPublisher,
  ForemPublisher,
  FarcasterPublisher,
  InstagramPublisher,
  isThreadCapable,
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
  ThreadSegment,
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
  forem: ForemPublisher,
  farcaster: FarcasterPublisher,
};

function buildContent(message: string, mediaFiles: MediaFile[]): Content {
  const media: Media[] = mediaFiles.map((file) =>
    file.type === "image"
      ? { type: "image", url: file.url, size: file.size }
      : {
          type: "video",
          url: file.url,
          size: file.size,
          thumbnailUrl: file.thumbnailUrl,
          durationSec: file.durationSec,
        }
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
  thread?: ThreadSegment[];
}): ValidationResultByPlatform {
  const accounts = getAccountsByIds(params.accountIds);
  const foundIds = new Set(accounts.map((a) => a.id));
  const missingAccountIds = params.accountIds.filter((id) => !foundIds.has(id));

  const platforms = [...new Set(accounts.map((account) => account.platform))];
  const overrides = params.accountOverrides || {};
  const sharedThread = params.thread ?? [];

  const results: PlatformValidationResponse[] = accounts.map((account) => {
    const override = overrides[account.id];
    const usesCommonContent = !override;
    const rootContent = buildContent(override?.message ?? params.message ?? "", override?.media ?? params.media ?? []);

    const accountThread = override?.thread ?? sharedThread;
    const threadAware = isThreadCapable(account.platform);
    const segments: Array<{ field: string; content: Content }> = [{ field: "text", content: rootContent }];

    if (threadAware) {
      for (const [index, segment] of accountThread.entries()) {
        segments.push({
          field: `thread[${index}]`,
          content: buildContent(segment.message ?? "", segment.media ?? []),
        });
      }
    }

    const errors: ValidationResult["errors"] = [];
    const warnings: ValidationResult["warnings"] = [];

    for (const { field, content } of segments) {
      const validation = validateContent(account.platform, content);
      const withMeta = (issue: ValidationResult["errors"][number]) => ({
        ...issue,
        field: issue.field === "text" ? field : `${field}.${issue.field}`,
        meta: { ...issue.meta, accountId: account.id },
      });
      for (const issue of validation.errors) errors.push(withMeta(issue));
      for (const issue of validation.warnings) warnings.push(withMeta(issue));
    }

    if (!threadAware && accountThread.length > 0) {
      warnings.push({
        platform: account.platform,
        severity: "warning",
        code: "thread_not_supported",
        message: `No threads on ${account.platform}. Root post only.`,
        field: "thread",
        meta: { accountId: account.id },
      });
    }

    return {
      accountId: account.id,
      platform: account.platform,
      rules: getValidationRules(account.platform),
      errors,
      warnings,
      isValid: errors.length === 0,
      usesCommonContent,
    };
  });

  // Cross-account check: if any thread segments exist but no selected account
  // supports threads, that's a hard error.
  const anyThread = sharedThread.length > 0 || Object.values(overrides).some((o) => (o.thread ?? []).length > 0);
  const anyThreadCapable = accounts.some((account) => isThreadCapable(account.platform));
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

  const errors = [...results.flatMap((r) => r.errors), ...crossAccountErrors];
  const warnings = results.flatMap((r) => r.warnings);

  return {
    platforms,
    results,
    summary: { errors, warnings, isValid: errors.length === 0 },
    accounts: accounts.map((account) => summarize(account)),
    missingAccountIds,
  };
}
