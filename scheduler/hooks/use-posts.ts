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

type RawSocialPost = Omit<SocialPost, "scheduledFor" | "createdAt" | "publishedAt"> & {
  scheduledFor?: string | null;
  createdAt: string;
  publishedAt?: string | null;
};

interface PostsResponse {
  posts: RawSocialPost[];
  pagination?: PaginationInfo;
}

export interface PaginatedPostsResult {
  posts: SocialPost[];
  pagination: PaginationInfo;
}

export interface PostCountsResult {
  counts: {
    drafts: number;
    failed: number;
    past: number;
    scheduled: number;
  };
  latestFailedAt: string | null;
}

function parsePost(post: RawSocialPost): SocialPost {
  return {
    ...post,
    scheduledFor: post.scheduledFor ? new Date(post.scheduledFor) : null,
    createdAt: new Date(post.createdAt),
    publishedAt: post.publishedAt ? new Date(post.publishedAt) : undefined,
  };
}

export type PostsListType = "drafts" | "scheduled" | "past" | "failed";

async function fetchPaginatedPosts(type: PostsListType, page: number, limit: number): Promise<PaginatedPostsResult> {
  const url = `/api/v1/posts?type=${type}&page=${page}&limit=${limit}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch posts");
  }
  const data: PostsResponse = await response.json();
  return {
    posts: (data.posts || []).map((post) => parsePost(post)),
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
  const response = await fetch(`/api/v1/posts/${id}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error("Failed to fetch post");
  }
  const data: { post: RawSocialPost } = await response.json();
  return data.post ? parsePost(data.post) : null;
}

async function fetchPostCounts(): Promise<PostCountsResult> {
  const response = await fetch("/api/v1/posts?type=counts");
  if (!response.ok) {
    throw new Error("Failed to fetch post counts");
  }
  return (await response.json()) as PostCountsResult;
}

export function usePaginatedPosts(type: PostsListType, page: number = 1, limit: number = 25) {
  return useQuery({
    queryKey: queryKeys.paginatedPosts(type, page, limit),
    queryFn: () => fetchPaginatedPosts(type, page, limit),
    placeholderData: keepPreviousData,
  });
}

export function usePostCounts() {
  return useQuery({
    queryKey: queryKeys.postCounts,
    queryFn: fetchPostCounts,
    refetchInterval: 30_000,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: queryKeys.post(id),
    queryFn: () => fetchPost(id),
    enabled: !!id,
  });
}
