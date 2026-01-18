import { useCallback, useEffect, useState } from "react";
import type { SocialPost } from "@/types";
import { hydratePost } from "@/lib/utils/posts";

export function usePost(postId: string) {
  const [post, setPost] = useState<SocialPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!postId) {
      setPost(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setPost(null);
      setError(null);
      const response = await fetch(`/api/posts/${postId}`);
      if (response.status === 404) {
        setPost(null);
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to load post");
      }
      const data = await response.json();
      setPost(data.post ? hydratePost(data.post) : null);
    } catch (err) {
      console.error("Failed to load post:", err);
      setError(err instanceof Error ? err.message : "Failed to load post");
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { post, loading, error, refresh };
}
