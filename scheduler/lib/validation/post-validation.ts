import { mapPlatformName } from "@simple-post/sdk/platform-names";
import { getValidationRulesForPlatform, validateContentForPlatform } from "@simple-post/sdk/validation";

import { getPlatformById } from "@/lib/config";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type {
  Content,
  Media,
  Platform,
  ThreadSegment,
  ValidationIssue,
  ValidationResult,
  PlatformValidationRules,
} from "@simple-post/sdk";

const THREAD_CAPABLE_PLATFORMS = new Set<Platform>(["x", "bluesky", "threads", "telegram"]);

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
          durationSec: file.durationSec,
        },
  );

  return {
    text: message ?? "",
    media: media.length > 0 ? media : undefined,
  };
};

function isThreadCapable(platform: Platform): boolean {
  return THREAD_CAPABLE_PLATFORMS.has(platform);
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

export function validatePostForResolvedAccounts(params: {
  message: string;
  media: MediaFile[];
  accounts: ConnectedAccount[];
  accountOverrides?: AccountOverridesMap;
  thread?: ThreadSegment[];
  accountOptions?: AccountOptionsMap;
}): ValidationResultByPlatform {
  const platforms = [...new Set(params.accounts.map((account) => mapPlatformName(account.platform)))] as Platform[];
  const overrides = params.accountOverrides || {};
  const sharedThread = params.thread ?? [];

  const results: PlatformValidationResponse[] = params.accounts.map((account) => {
    const platform = mapPlatformName(account.platform);
    const override = overrides[account.id];
    const usesCommonContent = !override;
    const rootContent = buildContent(override?.message ?? params.message ?? "", override?.media ?? params.media ?? []);

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
      const validation = validateContentForPlatform(platform, content);
      const withMeta = (issue: ValidationIssue) => ({
        ...issue,
        field: issue.field === "text" ? field : `${field}.${issue.field}`,
        meta: { ...issue.meta, accountId: account.id },
      });
      validation.errors.forEach((issue) => errors.push(withMeta(issue)));
      validation.warnings.forEach((issue) => warnings.push(withMeta(issue)));
    }

    if (platform === "reddit") {
      const accountOptions = params.accountOptions?.[account.id] ?? {};
      const subreddit = typeof accountOptions.subreddit === "string" ? accountOptions.subreddit.trim() : "";
      const title = typeof accountOptions.title === "string" ? accountOptions.title.trim() : "";
      if (!subreddit || !title) {
        errors.push({
          platform,
          severity: "error",
          code: "reddit_options_required",
          message: "Reddit posts require a subreddit and title. Set them in the account options.",
          field: "accountOptions",
          meta: { accountId: account.id },
        });
      }
    }

    if (!threadAware && accountThread.length > 0) {
      warnings.push({
        platform,
        severity: "warning",
        code: "thread_not_supported",
        message: `${getPlatformById(platform)?.name ?? platform} doesn't support threads, so only the first post will be published there.`,
        field: "thread",
        meta: { accountId: account.id },
      });
    }

    return {
      accountId: account.id,
      platform,
      rules: getValidationRulesForPlatform(platform),
      errors,
      warnings,
      isValid: errors.length === 0,
      usesCommonContent,
    };
  });

  const anyThread = sharedThread.length > 0 || Object.values(overrides).some((o) => (o.thread ?? []).length > 0);
  const anyThreadCapable = params.accounts.some((account) => isThreadCapable(mapPlatformName(account.platform)));
  const crossAccountErrors: ValidationResult["errors"] = [];
  if (anyThread && !anyThreadCapable) {
    crossAccountErrors.push({
      platform: "common",
      severity: "error",
      code: "no_thread_capable_accounts",
      message:
        "None of the selected accounts support threads. Remove the extra posts or add an account that supports them (X, Bluesky, Threads, or Telegram).",
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
    accounts: params.accounts,
  };
}
