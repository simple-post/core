/**
 * Scheduler-side adapter for `@simple-post/preview`.
 *
 * Platform normalization and the list of previewable platforms come from the
 * package so the scheduler can never drift from what the renderer supports.
 * Only scheduler-specific presentation constants live here.
 */
export {
  getUniquePreviewPlatforms,
  normalizePreviewPlatform,
  PREVIEW_PLATFORMS,
  type PreviewPlatform,
} from "@simple-post/preview";

/** Width of the preview frame, matching the renderer's default max-width. */
export const PREVIEW_FRAME_WIDTH = 390;
