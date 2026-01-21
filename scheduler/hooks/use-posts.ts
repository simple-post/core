"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-client";
import type { SocialPost } from "@/types";

interface PostsResponse {
  posts: any[];
}

function parsePost(post: any): SocialPost {
  return {
    ...post,
    scheduledFor: new Date(post.scheduledFor),
    createdAt: new Date(post.createdAt),
    publishedAt: post.publishedAt ? new Date(post.publishedAt) : undefined,
  };
}

async function fetchPosts(type?: string): Promise<SocialPost[]> {
  const url = type ? `/api/posts?type=${type}` : "/api/posts";
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch posts");
  }
  const data: PostsResponse = await response.json();
  return (data.posts || []).map(parsePost);
}

async function fetchPost(id: string): Promise<SocialPost | null> {
  const response = await fetch("/api/posts");
  if (!response.ok) {
    throw new Error("Failed to fetch posts");
  }
  const data: PostsResponse = await response.json();
  const foundPost = (data.posts || []).find((p: any) => p.id === id);
  return foundPost ? parsePost(foundPost) : null;
}

export function usePosts(type?: "scheduled" | "past" | "failed") {
  return useQuery({
    queryKey: queryKeys.posts(type),
    queryFn: () => fetchPosts(type),
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: queryKeys.post(id),
    queryFn: () => fetchPost(id),
    enabled: !!id,
  });
}
