export interface PlatformOptions {
  youtube?: {
    tags?: string[];
    categoryId?: string;
    playlistId?: string;
    selfDeclaredMadeForKids?: boolean;
    privacyStatus?: "public" | "private" | "unlisted";
    publishAt?: string;
  };
  tiktok?: {
    publishMode?: "draft" | "public";
    visibility?: "public" | "friends" | "private";
    allowComment?: boolean;
    allowDuet?: boolean;
    allowStitch?: boolean;
  };
  facebook?: {
    publishAt?: string;
  };
  instagram?: Record<string, never>;
}

export interface SocialPost {
  id: string;
  message: string;
  platforms: string[];
  media: MediaFile[];
  scheduledFor: Date;
  status: "scheduled" | "published" | "failed";
  createdAt: Date;
  publishedAt?: Date;
  platformOptions?: PlatformOptions;
}

export interface MediaFile {
  id: string;
  url: string;
  type: "image" | "video";
  filename: string;
  size: number;
}

export interface PostsRepository {
  getScheduledPosts(): Promise<SocialPost[]>;
  getPastPosts(): Promise<SocialPost[]>;
  createPost(post: Omit<SocialPost, "id" | "createdAt">): Promise<SocialPost>;
  updatePost(id: string, updates: Partial<SocialPost>): Promise<SocialPost>;
  deletePost(id: string): Promise<void>;
}
