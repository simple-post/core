import type { PostsRepository } from "./types";
import { LocalStorageRepository } from "./repositories/local-storage";
import { PrismaPostsRepository } from "./repositories/prisma";

type RepositoryType = "localStorage" | "database";

const REPOSITORY_TYPE: RepositoryType = "database";

export function createPostsRepository(): PostsRepository {
  switch (REPOSITORY_TYPE) {
    case "localStorage":
      return new LocalStorageRepository();
    case "database":
      return new PrismaPostsRepository();
    default:
      throw new Error(`Unknown repository type: ${REPOSITORY_TYPE}`);
  }
}

export const SOCIAL_PLATFORMS = [
  { id: "x", name: "X (Twitter)", color: "bg-black" },
  { id: "youtube", name: "YouTube", color: "bg-red-600" },
  { id: "tiktok", name: "TikTok", color: "bg-black" },
  { id: "facebook", name: "Facebook", color: "bg-blue-600" },
  { id: "instagram", name: "Instagram", color: "bg-gradient-to-r from-purple-500 to-pink-500" },
];
