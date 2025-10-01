export interface SocialPost {
  id: string
  message: string
  platforms: string[]
  media: MediaFile[]
  scheduledFor: Date
  status: "scheduled" | "published" | "failed"
  createdAt: Date
  publishedAt?: Date
}

export interface MediaFile {
  id: string
  url: string
  type: "image" | "video"
  filename: string
  size: number
}

export interface PostsRepository {
  getScheduledPosts(): Promise<SocialPost[]>
  getPastPosts(): Promise<SocialPost[]>
  createPost(post: Omit<SocialPost, "id" | "createdAt">): Promise<SocialPost>
  updatePost(id: string, updates: Partial<SocialPost>): Promise<SocialPost>
  deletePost(id: string): Promise<void>
}
