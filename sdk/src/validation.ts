import { BLUESKY_VALIDATION_RULES, validateBlueskyContent } from "./publishers/bluesky/validation";
import { FACEBOOK_VALIDATION_RULES, validateFacebookContent } from "./publishers/facebook/validation";
import { INSTAGRAM_VALIDATION_RULES, validateInstagramContent } from "./publishers/instagram/validation";
import { LINKEDIN_VALIDATION_RULES, validateLinkedInContent } from "./publishers/linkedin/validation";
import { PINTEREST_VALIDATION_RULES, validatePinterestContent } from "./publishers/pinterest/validation";
import { SLACK_VALIDATION_RULES, validateSlackContent } from "./publishers/slack/validation";
import { TELEGRAM_VALIDATION_RULES, validateTelegramContent } from "./publishers/telegram/validation";
import { THREADS_VALIDATION_RULES, validateThreadsContent } from "./publishers/threads/validation";
import { TIKTOK_VALIDATION_RULES, validateTikTokContent } from "./publishers/tiktok/validation";
import { X_VALIDATION_RULES, validateXContent } from "./publishers/x/validation";
import { YOUTUBE_VALIDATION_RULES, validateYouTubeContent } from "./publishers/youtube/validation";

import type { Content, Platform } from "./types/post";
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
  slack: { rules: SLACK_VALIDATION_RULES, validate: validateSlackContent },
};

export function getValidationRulesForPlatform(platform: Platform): PlatformValidationRules {
  return PLATFORM_VALIDATORS[platform]?.rules ?? {};
}

export function validateContentForPlatform(platform: Platform, content: Content): ValidationResult {
  return PLATFORM_VALIDATORS[platform]?.validate(content) ?? { errors: [], warnings: [], isValid: true };
}

export { BLUESKY_VALIDATION_RULES, validateBlueskyContent } from "./publishers/bluesky/validation";
export { FACEBOOK_VALIDATION_RULES, validateFacebookContent } from "./publishers/facebook/validation";
export { INSTAGRAM_VALIDATION_RULES, validateInstagramContent } from "./publishers/instagram/validation";
export { LINKEDIN_VALIDATION_RULES, validateLinkedInContent } from "./publishers/linkedin/validation";
export { PINTEREST_VALIDATION_RULES, validatePinterestContent } from "./publishers/pinterest/validation";
export { SLACK_VALIDATION_RULES, validateSlackContent } from "./publishers/slack/validation";
export { TELEGRAM_VALIDATION_RULES, validateTelegramContent } from "./publishers/telegram/validation";
export { THREADS_VALIDATION_RULES, validateThreadsContent } from "./publishers/threads/validation";
export { TIKTOK_VALIDATION_RULES, validateTikTokContent } from "./publishers/tiktok/validation";
export { X_VALIDATION_RULES, validateXContent } from "./publishers/x/validation";
export { YOUTUBE_VALIDATION_RULES, validateYouTubeContent } from "./publishers/youtube/validation";
