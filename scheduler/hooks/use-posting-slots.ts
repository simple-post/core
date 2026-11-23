"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { SourceCopy } from "@/lib/i18n/source-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { PostingSlotConfig } from "@/lib/posting-slots/occurrences";
import { queryKeys } from "@/lib/query-client";
import { ApiResponseError } from "@/lib/utils/api-response-error";

interface PostingSlotsResponse {
  slots: PostingSlotConfig[];
}

async function fetchPostingSlots(copy: SourceCopy): Promise<PostingSlotConfig[]> {
  const response = await fetch("/api/v1/posting-slots");
  if (!response.ok) {
    throw new ApiResponseError(
      await response.json().catch(() => null),
      copy("Failed to fetch posting slots"),
      response.status,
    );
  }
  const data = (await response.json()) as PostingSlotsResponse;
  return data.slots;
}

async function updatePostingSlots(slots: PostingSlotConfig[], copy: SourceCopy): Promise<PostingSlotConfig[]> {
  const response = await fetch("/api/v1/posting-slots", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ slots }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || copy("Failed to update posting slots"));
  }

  const data = (await response.json()) as PostingSlotsResponse;
  return data.slots;
}

export function usePostingSlots() {
  const { copy } = useUiCopy();
  return useQuery({
    queryKey: queryKeys.postingSlots,
    queryFn: () => fetchPostingSlots(copy),
  });
}

export function useUpdatePostingSlots() {
  const { copy } = useUiCopy();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (slots: PostingSlotConfig[]) => updatePostingSlots(slots, copy),
    onSuccess: (slots) => {
      queryClient.setQueryData(queryKeys.postingSlots, slots);
    },
  });
}
