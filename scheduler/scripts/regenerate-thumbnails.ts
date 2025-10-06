/**
 * Script to regenerate thumbnails for existing posts
 * Run with: npx tsx scripts/regenerate-thumbnails.ts
 */

import { PrismaClient } from "@prisma/client";
import { generateThumbnail } from "../lib/thumbnail";
import { uploadToR2, generateFileKey } from "../lib/r2";

const prisma = new PrismaClient();

async function regenerateThumbnails() {
  console.log("Starting thumbnail regeneration...\n");

  // Find all media files without thumbnails
  const mediaFiles = await prisma.mediaFile.findMany({
    where: {
      thumbnailUrl: null,
    },
    include: {
      post: true,
    },
  });

  console.log(`Found ${mediaFiles.length} media files without thumbnails\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const media of mediaFiles) {
    try {
      console.log(`Processing: ${media.filename} (${media.type})`);

      // Download the original file from R2
      const response = await fetch(media.url);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());

      // Determine content type
      const contentType = media.type === "video" ? "video/mp4" : "image/jpeg";

      // Generate thumbnail
      const thumbnail = await generateThumbnail(buffer, media.filename, contentType);

      if (thumbnail) {
        // Upload thumbnail to R2
        const thumbnailKey = generateFileKey(media.post.userId, thumbnail.filename);
        const thumbnailUrl = await uploadToR2(thumbnail.buffer, thumbnailKey, "image/jpeg");

        // Update database
        await prisma.mediaFile.update({
          where: { id: media.id },
          data: { thumbnailUrl },
        });

        console.log(`✓ Generated thumbnail: ${thumbnailUrl}\n`);
        successCount++;
      } else {
        console.log(`✗ Failed to generate thumbnail (returned null)\n`);
        errorCount++;
      }
    } catch (error) {
      console.error(`✗ Error processing ${media.filename}:`, error);
      console.log();
      errorCount++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Total: ${mediaFiles.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);

  await prisma.$disconnect();
}

// Run the script
regenerateThumbnails()
  .then(() => {
    console.log("\nDone!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
