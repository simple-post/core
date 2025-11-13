import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { PostsModel } from "@/lib/db";
import { deleteFromR2, getKeyFromUrl, uploadToR2, generateFileKey } from "@/lib/r2";
import { generateThumbnail } from "@/lib/utils/thumbnail";
import type { MediaFile } from "@/types";

// PATCH /api/posts/[id] - Update a post
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const repository = new PostsModel(session.user.id);

    // Get the current post to know what media exists
    const allPosts = await repository.getScheduledPosts();
    const pastPosts = await repository.getPastPosts();
    const currentPost = [...allPosts, ...pastPosts].find((p) => p.id === params.id);

    if (!currentPost) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    // Parse form data
    const formData = await req.formData();
    const message = formData.get("message") as string;
    const accountIds = JSON.parse(formData.get("accountIds") as string);
    const scheduledFor = new Date(formData.get("scheduledFor") as string);
    const accountOptions = formData.get("accountOptions")
      ? JSON.parse(formData.get("accountOptions") as string)
      : undefined;

    // Handle media updates
    const keepMediaIds = formData.get("keepMediaIds") ? JSON.parse(formData.get("keepMediaIds") as string) : [];
    const keepMediaIdsSet = new Set(keepMediaIds);

    // Determine which media files to delete
    const mediaToDelete = currentPost.media.filter((m) => !keepMediaIdsSet.has(m.id));

    // Delete removed media files from R2
    for (const media of mediaToDelete) {
      const key = getKeyFromUrl(media.url);
      if (key) {
        try {
          await deleteFromR2(key);
        } catch (error) {
          console.error(`Failed to delete media from R2: ${key}`, error);
        }
      }

      // Also delete thumbnail if it exists
      if (media.thumbnailUrl) {
        const thumbnailKey = getKeyFromUrl(media.thumbnailUrl);
        if (thumbnailKey) {
          try {
            await deleteFromR2(thumbnailKey);
          } catch (error) {
            console.error(`Failed to delete thumbnail from R2: ${thumbnailKey}`, error);
          }
        }
      }
    }

    // Keep existing media that should be kept
    const finalMedia: MediaFile[] = currentPost.media.filter((m) => keepMediaIdsSet.has(m.id));

    // Upload new media files
    const newFiles = formData.getAll("media");
    for (const file of newFiles) {
      if (file instanceof File) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const key = generateFileKey(session.user.id, file.name);
        const url = await uploadToR2(buffer, key, file.type);

        // Generate and upload thumbnail
        let thumbnailUrl: string | undefined;
        const thumbnail = await generateThumbnail(buffer, file.name, file.type);
        if (thumbnail) {
          const thumbnailKey = generateFileKey(session.user.id, thumbnail.filename);
          thumbnailUrl = await uploadToR2(thumbnail.buffer, thumbnailKey, "image/jpeg");
        }

        const mediaType: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";
        finalMedia.push({
          id: crypto.randomUUID(),
          url,
          thumbnailUrl,
          type: mediaType,
          filename: file.name,
          size: file.size,
        });
      }
    }

    // Update the post
    const post = await repository.updatePost(params.id, {
      message,
      accountIds,
      scheduledFor,
      accountOptions,
      media: finalMedia,
    });

    return NextResponse.json({ post });
  } catch (error) {
    console.error("Error updating post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/posts/[id] - Delete a post
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const repository = new PostsModel(session.user.id);

    // Get the post to delete its media from R2
    const posts = await repository.getScheduledPosts();
    const pastPosts = await repository.getPastPosts();
    const allPosts = [...posts, ...pastPosts];
    const post = allPosts.find((p) => p.id === params.id);

    // Delete media files from R2
    if (post && post.media.length > 0) {
      await Promise.all(
        post.media.map(async (media) => {
          const key = getKeyFromUrl(media.url);
          if (key) {
            try {
              await deleteFromR2(key);
            } catch (error) {
              console.error(`Failed to delete media from R2: ${key}`, error);
            }
          }
        }),
      );
    }

    await repository.deletePost(params.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting post:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
