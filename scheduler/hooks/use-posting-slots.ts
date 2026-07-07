"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PostingSlotConfig } from "@/lib/posting-slots/occurrences";
import { queryKeys } from "@/lib/query-client";

interface PostingSlotsResponse {
  slots: PostingSlotConfig[];
}

async function fetchPostingSlots(): Promise<PostingSlotConfig[]> {
  const response = await fetch("/api/v1/posting-slots");
  if (!response.ok) {
    throw new Error("Failed to fetch posting slots");
  }
  const data = (await response.json()) as PostingSlotsResponse;
  return data.slots;
}

async function updatePostingSlots(slots: PostingSlotConfig[]): Promise<PostingSlotConfig[]> {
  const response = await fetch("/api/v1/posting-slots", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slots }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Failed to update posting slots");
  }

  const data = (await response.json()) as PostingSlotsResponse;
  return data.slots;
}

export function usePostingSlots() {
  return useQuery({
    queryKey: queryKeys.postingSlots,
    queryFn: fetchPostingSlots,
  });
}

export function useUpdatePostingSlots() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updatePostingSlots,
    onSuccess: (slots) => {
      queryClient.setQueryData(queryKeys.postingSlots, slots);
    },
  });
}
