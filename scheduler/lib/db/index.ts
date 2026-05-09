import { prisma } from "@/lib/prisma";
import {
  type AccountOptionsMap,
  type AccountOverridesMap,
  type SocialPost,
  type ThreadSegment,
  type ThreadSegmentResult,
} from "@/types";

export interface PaginationOptions {
  page?: number;
  limit?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export class PostsModel {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  async getScheduledPosts(options: PaginationOptions = {}): Promise<PaginatedResult<SocialPost>> {
    const { page = 1, limit = 25 } = options;
    const skip = (page - 1) * limit;
    const now = new Date();

    const where = {
      userId: this.userId,
      status: "scheduled",
      scheduledFor: {
        gt: now,
      },
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          media: true,
          accounts: true,
        },
        orderBy: {
          scheduledFor: "asc",
        },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: posts.map((post) => this.mapPostToSocialPost(post)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getDraftPosts(options: PaginationOptions = {}): Promise<PaginatedResult<SocialPost>> {
    const { page = 1, limit = 25 } = options;
    const skip = (page - 1) * limit;

    const where = {
      userId: this.userId,
      status: "draft",
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          media: true,
          accounts: true,
        },
        orderBy: {
          updatedAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: posts.map((post) => this.mapPostToSocialPost(post)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getPastPosts(options: PaginationOptions = {}): Promise<PaginatedResult<SocialPost>> {
    const { page = 1, limit = 25 } = options;
    const skip = (page - 1) * limit;
    const now = new Date();

    const where = {
      userId: this.userId,
      OR: [
        { status: "published" },
        {
          status: "scheduled",
          scheduledFor: {
            lte: now,
          },
        },
      ],
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          media: true,
          accounts: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: posts.map((post) => this.mapPostToSocialPost(post)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getPublishedPosts(options: PaginationOptions = {}): Promise<PaginatedResult<SocialPost>> {
    const { page = 1, limit = 25 } = options;
    const skip = (page - 1) * limit;

    const where = {
      userId: this.userId,
      status: "published",
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          media: true,
          accounts: true,
        },
        orderBy: [
          {
            publishedAt: "desc",
          },
          {
            createdAt: "desc",
          },
        ],
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: posts.map((post) => this.mapPostToSocialPost(post)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async getFailedPosts(options: PaginationOptions = {}): Promise<PaginatedResult<SocialPost>> {
    const { page = 1, limit = 25 } = options;
    const skip = (page - 1) * limit;

    const where = {
      userId: this.userId,
      status: "failed",
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          media: true,
          accounts: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip,
        take: limit,
      }),
      prisma.post.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: posts.map((post) => this.mapPostToSocialPost(post)),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async createPost(postData: Omit<SocialPost, "id" | "createdAt">, userId: string): Promise<SocialPost> {
    const post = await prisma.post.create({
      data: {
        userId,
        message: postData.message,
        scheduledFor: postData.scheduledFor,
        status: postData.status,
        publishedAt: postData.publishedAt,
        accountOptions: (postData.accountOptions as object) || undefined,
        accountOverrides: (postData.accountOverrides as object) || undefined,
        thread: postData.thread ? (postData.thread as unknown as object) : undefined,
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

    return this.mapPostToSocialPost(post as Parameters<typeof this.mapPostToSocialPost>[0]);
  }

  async updatePost(id: string, updates: Partial<SocialPost>): Promise<SocialPost> {
    const updateData: {
      message?: string;
      scheduledFor?: Date | null;
      status?: string;
      errorMessage?: string | null;
      errorDetails?: unknown | null;
      publishedAt?: Date | null;
      accountOptions?: unknown | null;
      accountOverrides?: unknown | null;
      thread?: unknown | null;
      threadResults?: unknown | null;
      accounts?: { set: Array<{ id: string }> };
      media?: { deleteMany: Record<string, never>; create: Array<Record<string, unknown>> };
    } = {};

    if (updates.message !== undefined) updateData.message = updates.message;
    if (updates.scheduledFor !== undefined) updateData.scheduledFor = updates.scheduledFor;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.errorMessage !== undefined) updateData.errorMessage = updates.errorMessage || null;
    if (updates.errorDetails !== undefined) updateData.errorDetails = updates.errorDetails || null;
    if (updates.publishedAt !== undefined) updateData.publishedAt = updates.publishedAt;
    if (updates.accountOptions !== undefined) updateData.accountOptions = updates.accountOptions || null;
    if (updates.accountOverrides !== undefined) updateData.accountOverrides = updates.accountOverrides || null;
    if (updates.thread !== undefined) updateData.thread = updates.thread ?? null;
    if (updates.threadResults !== undefined) updateData.threadResults = updates.threadResults ?? null;

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
      where: { id, userId: this.userId },
      data: updateData as Parameters<typeof prisma.post.update>[0]["data"],
      include: {
        media: true,
        accounts: true,
      },
    });

    return this.mapPostToSocialPost(post);
  }

  async getPostById(id: string): Promise<SocialPost | null> {
    const post = await prisma.post.findFirst({
      where: {
        id,
        userId: this.userId,
      },
      include: {
        media: true,
        accounts: true,
      },
    });

    if (!post) {
      return null;
    }

    return this.mapPostToSocialPost(post);
  }

  async deletePost(id: string): Promise<void> {
    await prisma.post.delete({
      where: { id, userId: this.userId },
    });
  }

  private mapPostToSocialPost(post: {
    id: string;
    message: string;
    scheduledFor: Date | null;
    status: string;
    errorMessage: string | null;
    errorDetails: unknown;
    createdAt: Date;
    publishedAt: Date | null;
    accountOptions: unknown;
    accountOverrides?: unknown;
    thread?: unknown;
    threadResults?: unknown;
    accounts: Array<{ id: string }>;
    media: Array<{
      id: string;
      url: string;
      thumbnailUrl: string | null;
      type: string;
      filename: string;
      size: number;
    }>;
  }): SocialPost {
    return {
      id: post.id,
      message: post.message,
      accountIds: post.accounts.map((a) => a.id),
      media: post.media.map((m) => ({
        id: m.id,
        url: m.url,
        thumbnailUrl: m.thumbnailUrl ?? undefined,
        type: m.type as "image" | "video",
        filename: m.filename,
        size: m.size,
      })),
      scheduledFor: post.scheduledFor ? new Date(post.scheduledFor) : null,
      status: post.status as SocialPost["status"],
      errorMessage: post.errorMessage ?? undefined,
      errorDetails: (post.errorDetails as Record<string, unknown> | null) ?? undefined,
      createdAt: new Date(post.createdAt),
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : undefined,
      accountOptions: (post.accountOptions as AccountOptionsMap | null) || undefined,
      accountOverrides: (post.accountOverrides as AccountOverridesMap | null) || undefined,
      thread: (post.thread as ThreadSegment[] | null) ?? undefined,
      threadResults: (post.threadResults as Record<string, ThreadSegmentResult[]> | null) ?? undefined,
    };
  }
}
