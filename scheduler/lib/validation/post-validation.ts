import { mapPlatformName } from "@simple-post/sdk/platform-names";
import { getValidationRulesForPlatform, validateContentForPlatform } from "@simple-post/sdk/validation";

import { isPreviewOnlyConnectedAccount } from "@/lib/accounts/account-state";
import { getPlatformById, isSocialPlatformEnabled } from "@/lib/config";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount, MediaFile } from "@/types";

import type {
  Content,
  Media,
  Platform,
  ThreadSegment,
  ValidationIssue,
  ValidationResult,
  PlatformValidationRules,
  TikTokOptions,
} from "@simple-post/sdk";

const THREAD_CAPABLE_PLATFORMS = new Set<Platform>(["x", "bluesky", "threads", "telegram"]);
const TIKTOK_PRIVACY_LEVELS = new Set([
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
]);

const buildContent = (message: string, mediaFiles: MediaFile[]): Content => {
  const media: Media[] = mediaFiles.map((file) =>
    file.type === "image"
      ? {
          type: "image",
          url: file.url,
          size: file.size,
        }
      : {
          type: "video",
          url: file.url,
          size: file.size,
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

function getTikTokPrivacyLevel(options: Record<string, unknown>): string | undefined {
  const privacyLevel = options.privacyLevel;
  if (typeof privacyLevel === "string" && TIKTOK_PRIVACY_LEVELS.has(privacyLevel)) {
    return privacyLevel;
  }

  switch (options.visibility) {
    case "public": {
      return "PUBLIC_TO_EVERYONE";
    }
    case "friends": {
      return "MUTUAL_FOLLOW_FRIENDS";
    }
    case "private": {
      return "SELF_ONLY";
    }
    default: {
      return undefined;
    }
  }
}

function validateAccountOptions(account: ConnectedAccount, accountOptions?: AccountOptionsMap): ValidationIssue[] {
  if (mapPlatformName(account.platform) === "youtube" && accountOptions?.[account.id]?.playlistId) {
    return [
      {
        platform: "youtube",
        severity: "error",
        code: "youtube_playlist_unavailable",
        message:
          "YouTube playlist assignment is temporarily unavailable. Remove the playlist option and add the video to a playlist in YouTube Studio after publishing.",
        field: "accountOptions.playlistId",
        meta: { accountId: account.id },
      },
    ];
  }
  if (mapPlatformName(account.platform) === "pinterest") {
    const boardId = accountOptions?.[account.id]?.boardId;
    return typeof boardId === "string" && boardId.trim()
      ? []
      : [
          {
            platform: "pinterest",
            severity: "error",
            code: "pinterest_board_required",
            message:
              'Select a Pinterest board before posting or scheduling this account. Set accountOptions["' +
              account.id +
              '"].boardId.',
            field: "accountOptions.boardId",
            meta: { accountId: account.id },
          },
        ];
  }
  if (mapPlatformName(account.platform) !== "tiktok") {
    return [];
  }

  const options = accountOptions?.[account.id] ?? {};
  if (options.publishMode === "draft") {
    return [];
  }

  const errors: ValidationIssue[] = [];
  const privacyLevel = getTikTokPrivacyLevel(options);

  if (!privacyLevel) {
    errors.push({
      platform: "tiktok",
      severity: "error",
      code: "tiktok_privacy_status_required",
      message: `Select a TikTok privacy status before posting or scheduling this account. Set accountOptions["${account.id}"].privacyLevel to the user-selected value; MCP clients can call get_tiktok_creator_info for available choices.`,
      field: "accountOptions.privacyLevel",
      meta: { accountId: account.id },
    });
  }

  if (
    options.commercialContentDisclosure === true &&
    options.discloseYourBrand !== true &&
    options.discloseBrandedContent !== true
  ) {
    errors.push({
      platform: "tiktok",
      severity: "error",
      code: "tiktok_commercial_disclosure_required",
      message: "Indicate whether this content promotes your brand, a third-party brand, or both.",
      field: "accountOptions.commercialContentDisclosure",
      meta: { accountId: account.id },
    });
  }

  if (options.discloseBrandedContent === true && privacyLevel === "SELF_ONLY") {
    errors.push({
      platform: "tiktok",
      severity: "error",
      code: "tiktok_branded_content_private",
      message: "Branded content visibility cannot be set to private.",
      field: "accountOptions.privacyLevel",
      meta: { accountId: account.id },
    });
  }

  return errors;
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
  accountOptions?: AccountOptionsMap;
  accountOverrides?: AccountOverridesMap;
  thread?: ThreadSegment[];
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

    errors.push(...validateAccountOptions(account, params.accountOptions));

    if (!isSocialPlatformEnabled(account.platform)) {
      errors.push({
        platform,
        severity: "error",
        code: "provider_disabled",
        message: `${getPlatformById(account.platform)?.name ?? account.platform} is not enabled in this environment.`,
        field: "accounts",
        meta: { accountId: account.id },
      });
    }

    if (isPreviewOnlyConnectedAccount(account)) {
      errors.push({
        platform,
        severity: "error",
        code: "preview_only_account",
        message: `${getPlatformById(platform)?.name ?? platform} is configured for preview only. Connect a real account before posting.`,
        field: "accounts",
        meta: { accountId: account.id },
      });
    }

    for (const { field, content } of segments) {
      const validation = validateContentForPlatform(platform, content, {
        tiktok: params.accountOptions?.[account.id] as TikTokOptions | undefined,
      });
      const withMeta = (issue: ValidationIssue) => ({
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
