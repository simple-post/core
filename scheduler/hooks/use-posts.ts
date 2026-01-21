"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-client";
import type { SocialPost } from "@/types";

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface PostsResponse {
  posts: any[];
  pagination?: PaginationInfo;
}

export interface PaginatedPostsResult {
  posts: SocialPost[];
  pagination: PaginationInfo;
}

function parsePost(post: any): SocialPost {
  return {
    ...post,
    scheduledFor: new Date(post.scheduledFor),
    createdAt: new Date(post.createdAt),
    publishedAt: post.publishedAt ? new Date(post.publishedAt) : undefined,
  };
}

async function fetchPaginatedPosts(
  type: "scheduled" | "past" | "failed",
  page: number,
  limit: number
): Promise<PaginatedPostsResult> {
  const url = `/api/posts?type=${type}&page=${page}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch posts");
  }
  const data: PostsResponse = await response.json();
  return {
    posts: (data.posts || []).map(parsePost),
    pagination: data.pagination || {
      page,
      limit,
      total: data.posts?.length || 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    },
  };
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

export function usePaginatedPosts(
  type: "scheduled" | "past" | "failed",
  page: number = 1,
  limit: number = 20
) {
  return useQuery({
    queryKey: queryKeys.paginatedPosts(type, page, limit),
    queryFn: () => fetchPaginatedPosts(type, page, limit),
    placeholderData: keepPreviousData,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: queryKeys.post(id),
    queryFn: () => fetchPost(id),
    enabled: !!id,
  });
}
