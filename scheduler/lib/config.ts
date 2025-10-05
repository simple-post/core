import type { PostsRepository } from "./types";
import { LocalStorageRepository } from "./repositories/local-storage";

type RepositoryType = "localStorage" | "vercelKV";

const REPOSITORY_TYPE: RepositoryType = "localStorage";

export function createPostsRepository(): PostsRepository {
  switch (REPOSITORY_TYPE) {
    case "localStorage":
      return new LocalStorageRepository();
    case "vercelKV":
      // Future implementation when KV is available
      throw new Error("VercelKV repository not implemented yet");
    default:
      throw new Error(`Unknown repository type: ${REPOSITORY_TYPE}`);
  }
}

export const SOCIAL_PLATFORMS = [
  { id: "youtube", name: "YouTube", color: "bg-red-600" },
  { id: "tiktok", name: "TikTok", color: "bg-black" },
  { id: "facebook", name: "Facebook", color: "bg-blue-600" },
  { id: "instagram", name: "Instagram", color: "bg-gradient-to-r from-purple-500 to-pink-500" },
];
