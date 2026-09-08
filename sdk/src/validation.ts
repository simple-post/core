import { BLUESKY_VALIDATION_RULES, validateBlueskyContent } from "./publishers/bluesky/validation";
import { FACEBOOK_VALIDATION_RULES, validateFacebookContent } from "./publishers/facebook/validation";
import { FOREM_VALIDATION_RULES, validateForemContent } from "./publishers/forem/validation";
import { INSTAGRAM_VALIDATION_RULES, validateInstagramContent } from "./publishers/instagram/validation";
import { LINKEDIN_VALIDATION_RULES, validateLinkedInContent } from "./publishers/linkedin/validation";
import { PINTEREST_VALIDATION_RULES, validatePinterestContent } from "./publishers/pinterest/validation";
import { TELEGRAM_VALIDATION_RULES, validateTelegramContent } from "./publishers/telegram/validation";
import { THREADS_VALIDATION_RULES, validateThreadsContent } from "./publishers/threads/validation";
import { TIKTOK_VALIDATION_RULES, validateTikTokContent } from "./publishers/tiktok/validation";
import { X_VALIDATION_RULES, validateXContent } from "./publishers/x/validation";
import { YOUTUBE_VALIDATION_RULES, validateYouTubeContent } from "./publishers/youtube/validation";
import { validateFinalOptions } from "./validation/final-options";

import type { Content, Platform, PostOptions } from "./types/post";
import type { PlatformValidationRules, ValidationResult } from "./types/validation";

interface PlatformValidator {
  rules: PlatformValidationRules;
  validate: (content: Content) => ValidationResult;
}

export const PLATFORM_VALIDATORS: Record<Platform, PlatformValidator> = {
  x: { rules: X_VALIDATION_RULES, validate: validateXContent },
  youtube: { rules: YOUTUBE_VALIDATION_RULES, validate: validateYouTubeContent },
  telegram: { rules: TELEGRAM_VALIDATION_RULES, validate: validateTelegramContent },
  facebook: { rules: FACEBOOK_VALIDATION_RULES, validate: validateFacebookContent },
  instagram: { rules: INSTAGRAM_VALIDATION_RULES, validate: validateInstagramContent },
  tiktok: { rules: TIKTOK_VALIDATION_RULES, validate: validateTikTokContent },
  bluesky: { rules: BLUESKY_VALIDATION_RULES, validate: validateBlueskyContent },
  threads: { rules: THREADS_VALIDATION_RULES, validate: validateThreadsContent },
  linkedin: { rules: LINKEDIN_VALIDATION_RULES, validate: validateLinkedInContent },
  pinterest: { rules: PINTEREST_VALIDATION_RULES, validate: validatePinterestContent },
  forem: { rules: FOREM_VALIDATION_RULES, validate: validateForemContent },
};

export function getValidationRulesForPlatform(platform: Platform): PlatformValidationRules {
  return PLATFORM_VALIDATORS[platform]?.rules ?? {};
}

export function validateContentForPlatform(
  platform: Platform,
  content: Content,
  options?: PostOptions,
): ValidationResult {
  let result: ValidationResult;
  switch (platform) {
    case "tiktok": {
      result = validateTikTokContent(content, options?.tiktok);
      break;
    }
    case "youtube": {
      result = validateYouTubeContent(content, options?.youtube);
      break;
    }
    case "pinterest": {
      result = validatePinterestContent(content, options?.pinterest);
      break;
    }
    default: {
      result = PLATFORM_VALIDATORS[platform].validate(content);
    }
  }
  // Silent attachment loss is never a successful validation.
  const destructive = new Set([
    "too_many_images",
    "too_many_videos",
    "too_many_media",
    "images_ignored",
    "title_truncated",
  ]);
  result.errors.push(
    ...result.warnings
      .filter((issue) => destructive.has(issue.code))
      .map((issue) => ({
        ...issue,
        severity: "error" as const,
        message: `${issue.message.split(". Only")[0].split(". The title")[0]}. Remove extra attachments before publishing.`,
      })),
  );
  result.warnings = result.warnings.filter((issue) => !destructive.has(issue.code));
  const extra = validateFinalOptions(platform, content, options);
  if (platform === "telegram")
    result.errors = result.errors.filter((issue) => !["text_too_long", "caption_too_long"].includes(issue.code));
  result.errors.push(...extra.filter((issue) => issue.severity === "error"));
  result.warnings.push(...extra.filter((issue) => issue.severity === "warning"));
  result.isValid = result.errors.length === 0;
  return result;
}

export { BLUESKY_VALIDATION_RULES, validateBlueskyContent } from "./publishers/bluesky/validation";
export { FACEBOOK_VALIDATION_RULES, validateFacebookContent } from "./publishers/facebook/validation";
export { FOREM_VALIDATION_RULES, validateForemContent } from "./publishers/forem/validation";
export { INSTAGRAM_VALIDATION_RULES, validateInstagramContent } from "./publishers/instagram/validation";
export { LINKEDIN_VALIDATION_RULES, validateLinkedInContent } from "./publishers/linkedin/validation";
export { PINTEREST_VALIDATION_RULES, validatePinterestContent } from "./publishers/pinterest/validation";
export { TELEGRAM_VALIDATION_RULES, validateTelegramContent } from "./publishers/telegram/validation";
export { THREADS_VALIDATION_RULES, validateThreadsContent } from "./publishers/threads/validation";
export { TIKTOK_VALIDATION_RULES, validateTikTokContent } from "./publishers/tiktok/validation";
export { X_VALIDATION_RULES, validateXContent, getXTextLength } from "./publishers/x/validation";
export { YOUTUBE_VALIDATION_RULES, validateYouTubeContent } from "./publishers/youtube/validation";
