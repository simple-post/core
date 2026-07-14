"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query-client";
import type { PostingMode, SocialPost } from "@/types";

const POSTING_PROGRESS_CONTENT_TYPE = "application/x-ndjson";

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
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || "Failed to disconnect account");
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
export function useConnectForem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { instanceUrl: string; apiKey: string }) => {
      const response = await fetch("/api/connect/forem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to connect Forem");
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

export interface FarcasterTypedData {
  domain: { name: string; version: string; chainId: number };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: "KeyAdd";
  message: Record<string, unknown>;
}

export function usePrepareFarcaster() {
  return useMutation({
    mutationFn: async (params: { custodyAddress: string }) => {
      const response = await fetch("/api/connect/farcaster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare", ...params }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to prepare Farcaster authorization");
      return data as {
        action: "sign";
        fid: number;
        custodyAddress: string;
        requestToken: string;
        signerExpiresInSeconds: number;
        typedData: FarcasterTypedData;
      };
    },
  });
}

export function useConnectFarcaster() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { requestToken: string; custodySignature: string }) => {
      const response = await fetch("/api/connect/farcaster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "complete", ...params }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Failed to connect Farcaster");
      }
      return data as { success: true; fid: number; username: string | null };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts }),
  });
}

// Create/Update post mutation
interface PostMutationParams {
  body: {
    message: string;
    accountIds: string[];
    postingMode: PostingMode;
    scheduledFor?: string;
    accountOptions?: Record<string, unknown>;
    accountOverrides?: Record<string, unknown>;
    repost?: {
      enabled: boolean;
      delayHours: number;
    };
    media: Array<{
      id: string;
      url: string;
      thumbnailUrl?: string;
      type: "image" | "video";
      filename: string;
      size: number;
    }>;
    thread?: Array<{
      message: string;
      media?: Array<{
        id: string;
        url: string;
        thumbnailUrl?: string;
        type: "image" | "video";
        filename: string;
        size: number;
      }>;
    }>;
    quotePostId?: string | null;
  };
  mode: "create" | "edit";
  postId?: string;
  onPostingResult?: (result: PostingResult) => void;
}

export interface PostingResult {
  accountId: string;
  platform: string;
  success: boolean;
  error?: string;
  message?: string;
  postUrl?: string;
  postId?: string;
  details?: unknown;
  threadResults?: Array<{
    index: number;
    success: boolean;
    postId?: string;
    postUrl?: string;
    error?: string;
    message?: string;
    details?: unknown;
  }>;
}

interface PostMutationResult {
  post: SocialPost;
  postingResults?: PostingResult[];
}

type PostingProgressEvent =
  | { type: "result"; result: PostingResult }
  | { type: "complete"; data: PostMutationResult }
  | { type: "error"; error: string };

async function readPostingProgress(
  response: Response,
  onPostingResult: (result: PostingResult) => void,
): Promise<PostMutationResult> {
  if (!response.body) {
    throw new Error("Posting progress stream was unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: PostMutationResult | undefined;

  const processLine = (line: string) => {
    if (!line.trim()) return;

    const event = JSON.parse(line) as PostingProgressEvent;
    switch (event.type) {
      case "result": {
        onPostingResult(event.result);
        break;
      }
      case "complete": {
        completed = event.data;
        break;
      }
      case "error": {
        throw new Error(event.error);
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);

    if (done) break;
  }

  processLine(buffer);

  if (!completed) {
    throw new Error("Posting finished without a final response");
  }

  return completed;
}

async function submitPost({ body, mode, postId, onPostingResult }: PostMutationParams): Promise<PostMutationResult> {
  const url = mode === "edit" ? `/api/v1/posts/${postId}` : "/api/v1/posts";
  const method = mode === "edit" ? "PATCH" : "POST";
  const streamProgress = body.postingMode === "now" && typeof onPostingResult === "function";

  const response = await fetch(url, {
    method,
    headers: {
      ...(streamProgress ? { Accept: POSTING_PROGRESS_CONTENT_TYPE } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const message = typeof data?.error === "string" ? data.error : `Failed to ${mode} post`;
    throw new Error(message);
  }

  if (streamProgress && response.headers.get("content-type")?.includes(POSTING_PROGRESS_CONTENT_TYPE)) {
    return readPostingProgress(response, onPostingResult);
  }

  const result = (await response.json()) as PostMutationResult;
  if (streamProgress) {
    result.postingResults?.forEach(onPostingResult);
  }
  return result;
}

export function useSubmitPost() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitPost,
    onSuccess: (_data: PostMutationResult, variables: PostMutationParams) => {
      queryClient.invalidateQueries({ queryKey: ["posts"] });
      if (variables.postId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.post(variables.postId) });
      }
    },
  });
}
