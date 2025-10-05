import { PrismaClient } from "@prisma/client";
import type { PostsRepository, SocialPost, MediaFile } from "../types";

// Create a singleton Prisma client instance
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export class PrismaPostsRepository implements PostsRepository {
  private userId?: string;

  constructor(userId?: string) {
    this.userId = userId;
  }

  async getScheduledPosts(): Promise<SocialPost[]> {
    const now = new Date();
    const posts = await prisma.post.findMany({
      where: {
        ...(this.userId && { userId: this.userId }),
        status: "scheduled",
        scheduledFor: {
          gt: now,
        },
      },
      include: {
        media: true,
        accounts: true,
      },
      orderBy: {
        scheduledFor: "asc",
      },
    });

    return posts.map(this.mapPostToSocialPost);
  }

  async getPastPosts(): Promise<SocialPost[]> {
    const now = new Date();
    const posts = await prisma.post.findMany({
      where: {
        ...(this.userId && { userId: this.userId }),
        OR: [
          { status: "published" },
          {
            status: "scheduled",
            scheduledFor: {
              lte: now,
            },
          },
        ],
      },
      include: {
        media: true,
        accounts: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return posts.map(this.mapPostToSocialPost);
  }

  async createPost(postData: Omit<SocialPost, "id" | "createdAt">, userId: string): Promise<SocialPost> {
    const post = await prisma.post.create({
      data: {
        userId,
        message: postData.message,
        scheduledFor: postData.scheduledFor,
        status: postData.status,
        publishedAt: postData.publishedAt,
        accountOptions: postData.accountOptions || null,
        accounts: {
          connect: postData.accountIds.map((id) => ({ id })),
        },
        media: {
          create: postData.media.map((m) => ({
            url: m.url,
            thumbnailUrl: m.thumbnailUrl,
            type: m.type,
            filename: m.filename,
            size: m.size,
          })),
        },
      },
      include: {
        media: true,
        accounts: true,
      },
    });

    return this.mapPostToSocialPost(post);
  }

  async updatePost(id: string, updates: Partial<SocialPost>): Promise<SocialPost> {
    const updateData: any = {};

    if (updates.message !== undefined) updateData.message = updates.message;
    if (updates.scheduledFor !== undefined) updateData.scheduledFor = updates.scheduledFor;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.publishedAt !== undefined) updateData.publishedAt = updates.publishedAt;
    if (updates.accountOptions !== undefined) updateData.accountOptions = updates.accountOptions || null;

    // Handle account updates
    if (updates.accountIds !== undefined) {
      updateData.accounts = {
        set: updates.accountIds.map((id) => ({ id })),
      };
    }

    // Handle media updates
    if (updates.media !== undefined) {
      // Delete old media and create new ones
      updateData.media = {
        deleteMany: {},
        create: updates.media.map((m) => ({
          url: m.url,
          thumbnailUrl: m.thumbnailUrl,
          type: m.type,
          filename: m.filename,
          size: m.size,
        })),
      };
    }

    const post = await prisma.post.update({
      where: { id },
      data: updateData,
      include: {
        media: true,
        accounts: true,
      },
    });

    return this.mapPostToSocialPost(post);
  }

  async deletePost(id: string): Promise<void> {
    await prisma.post.delete({
      where: { id },
    });
  }

  private mapPostToSocialPost(post: any): SocialPost {
    return {
      id: post.id,
      message: post.message,
      accountIds: post.accounts.map((a: any) => a.id),
      media: post.media.map((m: any) => ({
        id: m.id,
        url: m.url,
        thumbnailUrl: m.thumbnailUrl,
        type: m.type as "image" | "video",
        filename: m.filename,
        size: m.size,
      })),
      scheduledFor: new Date(post.scheduledFor),
      status: post.status as "scheduled" | "published" | "failed",
      createdAt: new Date(post.createdAt),
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : undefined,
      accountOptions: post.accountOptions || undefined,
    };
  }
}
