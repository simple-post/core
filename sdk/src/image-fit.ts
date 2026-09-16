import { z } from "zod";

export const ImageFitSchema = z
  .enum(["crop", "blur"])
  .describe(
    "Opt in to fitting incompatible images to all selected platforms. crop trims edges; blur preserves the full image over a blurred background. Converts to JPEG and compresses only when needed. Animated images that need fitting become still images. Omit to keep originals. If the user already asked to fit images, apply their chosen method without asking again; default to blur when no method was specified.",
  );
export type ImageFit = z.infer<typeof ImageFitSchema>;

const FITTABLE_IMAGE_CODES = new Set([
  "image_too_large",
  "image_format_unsupported",
  "photo_format_unsupported",
  "photo_dimensions_too_large",
  "media_aspect_ratio_unsupported",
  "media_width_plus_height_unsupported",
  "media_pixel_count_unsupported",
  "media_animation_frames_unsupported",
  "media_animation_width_unsupported",
  "media_animation_height_unsupported",
  "media_animation_pixels_unsupported",
  "animated_gif_must_be_alone",
  "thumbnail_too_large",
]);

export function canFitImageIssue(issue: { code: string; field?: string; message?: string }): boolean {
  if (issue.code === "media_aspect_ratio_unsupported" && !issue.message?.includes("image")) return false;
  return FITTABLE_IMAGE_CODES.has(issue.code);
}

export const IMAGE_FIT_HELP =
  "These images can be fitted automatically. Offer crop (trim edges) or blur (keep the full image over a blurred background), then retry with imageFit set to the chosen method. If fitting was already requested, use that method without another question; default to blur. Fitting cannot fix missing media, attachment counts, or mixed image/video posts.";
