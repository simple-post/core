import { displayMessage, withDisplayMessage } from "./display-message";

import type { Content, Platform } from "../types/post";
import type { ValidationIssue, ValidationResult } from "../types/validation";

export function validateStoryPlacement(
  platform: Platform,
  content: Content,
  placement: unknown,
  facebookPublishAt?: string,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  if (placement === undefined) return { errors, warnings, isValid: true };

  if (platform !== "instagram" && platform !== "facebook") {
    errors.push(
      withDisplayMessage(
        { platform, severity: "error", code: "story_placement_unsupported", field: "placement" },
        displayMessage("Placement is available for Instagram and Facebook Pages."),
      ),
    );
  } else if (placement !== "post" && placement !== "story" && placement !== "both") {
    errors.push(
      withDisplayMessage(
        { platform, severity: "error", code: "story_placement_invalid", field: "placement" },
        displayMessage("Choose post, story, or both."),
      ),
    );
  } else if (placement !== "post") {
    const video = content.media?.length === 1 ? content.media[0] : undefined;
    if (video?.type !== "video" || (!video.path && !video.url)) {
      errors.push(
        withDisplayMessage(
          { platform, severity: "error", code: "story_video_required", field: "media" },
          displayMessage("Choose exactly one video to publish to Stories."),
        ),
      );
    }
    if (platform === "facebook" && facebookPublishAt) {
      errors.push(
        withDisplayMessage(
          { platform, severity: "error", code: "story_native_schedule_unsupported", field: "publishAt" },
          displayMessage("Use SimplePost scheduling for Facebook Stories. Clear the Facebook publication time."),
        ),
      );
    }
    if (placement === "story" && content.text?.trim()) {
      warnings.push(
        withDisplayMessage(
          { platform, severity: "warning", code: "story_caption_ignored", field: "text" },
          displayMessage("Stories use the video only. Add any on-screen text to the video before uploading."),
        ),
      );
    }
  }
  return { errors, warnings, isValid: errors.length === 0 };
}
