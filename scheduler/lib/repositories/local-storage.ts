import type { PostsRepository, SocialPost } from "../types";

export class LocalStorageRepository implements PostsRepository {
  private readonly STORAGE_KEY = "social-scheduler-posts";

  private getPosts(): SocialPost[] {
    if (typeof window === "undefined") return [];

    const stored = localStorage.getItem(this.STORAGE_KEY);
    if (!stored) return [];

    try {
      const posts = JSON.parse(stored);
      return posts.map((post: any) => ({
        ...post,
        scheduledFor: new Date(post.scheduledFor),
        createdAt: new Date(post.createdAt),
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : undefined,
        // Support both old and new format for backward compatibility
        accountIds: post.accountIds || post.platforms || [],
        accountOptions: post.accountOptions || post.platformOptions || undefined,
      }));
    } catch {
      return [];
    }
  }

  private savePosts(posts: SocialPost[]): void {
    if (typeof window === "undefined") return;
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(posts));
  }

  async getScheduledPosts(): Promise<SocialPost[]> {
    const posts = this.getPosts();
    const now = new Date();
    return posts
      .filter((post) => post.status === "scheduled" && post.scheduledFor > now)
      .sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime());
  }

  async getPastPosts(): Promise<SocialPost[]> {
    const posts = this.getPosts();
    const now = new Date();
    return posts
      .filter((post) => post.status === "published" || (post.status === "scheduled" && post.scheduledFor <= now))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createPost(postData: Omit<SocialPost, "id" | "createdAt">, userId: string): Promise<SocialPost> {
    const posts = this.getPosts();
    const newPost: SocialPost = {
      ...postData,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };

    posts.push(newPost);
    this.savePosts(posts);
    return newPost;
  }

  async updatePost(id: string, updates: Partial<SocialPost>): Promise<SocialPost> {
    const posts = this.getPosts();
    const index = posts.findIndex((post) => post.id === id);

    if (index === -1) {
      throw new Error(`Post with id ${id} not found`);
    }

    posts[index] = { ...posts[index], ...updates };
    this.savePosts(posts);
    return posts[index];
  }

  async deletePost(id: string): Promise<void> {
    const posts = this.getPosts();
    const filteredPosts = posts.filter((post) => post.id !== id);
    this.savePosts(filteredPosts);
  }
}
