import type { MediaInspection } from "./media-inspection";
import type { Platform } from "../types/post";

// Publish API formats, rather than the broader formats accepted by native apps.
// Instagram: https://developers.facebook.com/docs/instagram-platform/content-publishing/
// LinkedIn: https://learn.microsoft.com/linkedin/marketing/community-management/shares/images-api
// X: https://docs.x.com/x-api/media/quickstart/best-practices
// TikTok: https://developers.tiktok.com/doc/content-posting-api-media-transfer-guide
const IMAGE_FORMATS: Record<Platform, readonly string[]> = {
  instagram: ["image/jpeg"],
  threads: ["image/jpeg", "image/png"],
  linkedin: ["image/jpeg", "image/png", "image/gif"],
  tiktok: ["image/jpeg", "image/webp"],
  x: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  facebook: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  bluesky: ["image/jpeg", "image/png", "image/webp"],
  pinterest: ["image/jpeg", "image/png"],
  telegram: ["image/jpeg", "image/png", "image/webp"],
  forem: ["image/jpeg", "image/png", "image/gif", "image/webp"],
  youtube: ["image/jpeg", "image/png"],
};

export function mediaFormatFailure(
  inspection: MediaInspection,
  platform: Platform,
  expectedType: "image" | "video",
): { code: string; message: string } | undefined {
  if (!inspection.contentType.startsWith(`${expectedType}/`)) {
    return {
      code: "media_type_mismatch",
      message: `This attachment was declared as ${expectedType}, but contains ${inspection.contentType}. Upload the correct file.`,
    };
  }
  if (expectedType === "image" && !IMAGE_FORMATS[platform].includes(inspection.contentType)) {
    const formats = IMAGE_FORMATS[platform].map((type) => type.replace("image/", "").toUpperCase()).join(", ");
    return {
      code: "image_format_unsupported",
      message: `${platform} cannot publish this ${inspection.contentType.replace("image/", "").toUpperCase()} image. Upload an image in a supported format: ${formats}.`,
    };
  }
  return undefined;
}
