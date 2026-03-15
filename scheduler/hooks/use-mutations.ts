"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import type { SocialPost } from "@/types";

// Delete post mutation
async function deletePost(postId: string): Promise<void> {
  const response = await fetch(`/api/v1/posts/${postId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("Failed to delete post");
  }
}

export function useDeletePost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePost,
    onSuccess: () => {
      // Invalidate all post queries to refetch
      queryClient.invalidateQueries({ queryKey: ["posts"] });
    },
  });
}

// Disconnect account mutation
async function disconnectAccount(accountId: string): Promise<void> {
  const response = await fetch(`/api/v1/accounts/${accountId}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    throw new Error("Failed to disconnect account");
  }
}

export function useDisconnectAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: disconnectAccount,
    onSuccess: () => {
      // Invalidate accounts query to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

// Connect Telegram account mutation
interface ConnectTelegramParams {
  botToken: string;
  chatId: string;
  channelName?: string;
}

async function connectTelegram(params: ConnectTelegramParams): Promise<void> {
  const response = await fetch("/api/connect/telegram", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Failed to connect Telegram account");
  }
}

export function useConnectTelegram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: connectTelegram,
    onSuccess: () => {
      // Invalidate accounts query to refetch
      queryClient.invalidateQueries({ queryKey: queryKeys.accounts });
    },
  });
}

// Create/Update post mutation
interface PostMutationParams {
  body: {
    message: string;
    accountIds: string[];
    postingMode: "now" | "schedule";
    scheduledFor?: string;
    accountOptions?: Record<string, unknown>;
    accountOverrides?: Record<string, unknown>;
    media: Array<{
      id: string;
      url: string;
      thumbnailUrl?: string;
      type: "image" | "video";
      filename: string;
      size: number;
    }>;
  };
  mode: "create" | "edit";
  postId?: string;
}

interface PostMutationResult {
  post: SocialPost;
  postingResults?: Array<{
    accountId: string;
    platform: string;
    success: boolean;
    error?: string;
    postUrl?: string;
  }>;
}

async function submitPost({ body, mode, postId }: PostMutationParams): Promise<PostMutationResult> {
  const url = mode === "edit" ? `/api/v1/posts/${postId}` : "/api/v1/posts";
  const method = mode === "edit" ? "PATCH" : "POST";

  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Failed to ${mode} post`);
  }

  return response.json();
}

export function useSubmitPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitPost,
    onSuccess: (_data: PostMutationResult, variables: PostMutationParams) => {
      // Invalidate all post queries to refetch
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      if (variables.postId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.post(variables.postId) });
      }
    },
  });
}
