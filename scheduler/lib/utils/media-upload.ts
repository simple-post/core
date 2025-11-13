import { uploadToR2, generateFileKey } from "@/lib/r2";
import { generateThumbnail } from "@/lib/utils/thumbnail";
import type { MediaFile } from "@/types";

/**
 * Processes uploaded media files and uploads them to R2
 * @param files - Array of File objects from FormData
 * @param userId - User ID for file key generation
 * @returns Array of MediaFile objects with R2 URLs
 */
export async function processMediaFiles(files: (File | string)[], userId: string): Promise<MediaFile[]> {
  const mediaFiles: MediaFile[] = [];

  for (const file of files) {
    if (file instanceof File) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const key = generateFileKey(userId, file.name);
      const url = await uploadToR2(buffer, key, file.type);

      // Generate and upload thumbnail
      let thumbnailUrl: string | undefined;
      const thumbnail = await generateThumbnail(buffer, file.name, file.type);
      if (thumbnail) {
        const thumbnailKey = generateFileKey(userId, thumbnail.filename);
        thumbnailUrl = await uploadToR2(thumbnail.buffer, thumbnailKey, "image/jpeg");
      }

      const mediaType: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
      mediaFiles.push({
        id: crypto.randomUUID(),
        url,
        thumbnailUrl,
        type: mediaType,
        filename: file.name,
        size: file.size,
      });
    }
  }

  return mediaFiles;
}

