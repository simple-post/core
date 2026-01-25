"use client";

import type React from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";

import type { AccountOptionsMap, MediaFile } from "@/types";

export interface DraftAccountOverride {
  enabled: boolean;
  message: string;
  media: MediaFile[];
}

export type DraftAccountOverridesMap = Record<string, DraftAccountOverride>;

interface PostDraftState {
  message: string;
  media: MediaFile[];
  selectedAccountIds: string[];
  postingMode: "now" | "schedule";
  scheduledDate: string;
  scheduledTime: string;
  accountOptions: AccountOptionsMap;
  accountOverrides: DraftAccountOverridesMap;
}

interface PostDraftContextValue extends PostDraftState {
  setMessage: (value: string) => void;
  setMedia: (value: MediaFile[]) => void;
  setSelectedAccountIds: (value: string[]) => void;
  setPostingMode: (value: "now" | "schedule") => void;
  setScheduledDate: (value: string) => void;
  setScheduledTime: (value: string) => void;
  setAccountOptions: (value: AccountOptionsMap) => void;
  setAccountOverrides: (value: DraftAccountOverridesMap) => void;
  updateAccountOverride: (accountId: string, updates: Partial<DraftAccountOverride>) => void;
  setAccountOverrideEnabled: (accountId: string, enabled: boolean) => void;
  setAccountOverrideMessage: (accountId: string, message: string) => void;
  setAccountOverrideMedia: (accountId: string, media: MediaFile[]) => void;
  resetDraft: () => void;
}

const DEFAULT_DRAFT: PostDraftState = {
  message: "",
  media: [],
  selectedAccountIds: [],
  postingMode: "schedule",
  scheduledDate: "",
  scheduledTime: "",
  accountOptions: {},
  accountOverrides: {},
};

const PostDraftContext = createContext<PostDraftContextValue | null>(null);

export function PostDraftProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState(DEFAULT_DRAFT.message);
  const [media, setMedia] = useState<MediaFile[]>(DEFAULT_DRAFT.media);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(DEFAULT_DRAFT.selectedAccountIds);
  const [postingMode, setPostingMode] = useState<PostDraftState["postingMode"]>(DEFAULT_DRAFT.postingMode);
  const [scheduledDate, setScheduledDate] = useState(DEFAULT_DRAFT.scheduledDate);
  const [scheduledTime, setScheduledTime] = useState(DEFAULT_DRAFT.scheduledTime);
  const [accountOptions, setAccountOptions] = useState<AccountOptionsMap>(DEFAULT_DRAFT.accountOptions);
  const [accountOverrides, setAccountOverrides] = useState<DraftAccountOverridesMap>(DEFAULT_DRAFT.accountOverrides);

  const updateAccountOverride = useCallback((accountId: string, updates: Partial<DraftAccountOverride>) => {
    setAccountOverrides((prev) => {
      const current = prev[accountId] || { enabled: false, message: "", media: [] };
      return {
        ...prev,
        [accountId]: {
          ...current,
          ...updates,
        },
      };
    });
  }, []);

  const setAccountOverrideEnabled = useCallback(
    (accountId: string, enabled: boolean) => {
      updateAccountOverride(accountId, { enabled });
    },
    [updateAccountOverride],
  );

  const setAccountOverrideMessage = useCallback(
    (accountId: string, overrideMessage: string) => {
      updateAccountOverride(accountId, { message: overrideMessage });
    },
    [updateAccountOverride],
  );

  const setAccountOverrideMedia = useCallback(
    (accountId: string, overrideMedia: MediaFile[]) => {
      updateAccountOverride(accountId, { media: overrideMedia });
    },
    [updateAccountOverride],
  );

  const resetDraft = useCallback(() => {
    setMessage(DEFAULT_DRAFT.message);
    setMedia(DEFAULT_DRAFT.media);
    setSelectedAccountIds(DEFAULT_DRAFT.selectedAccountIds);
    setPostingMode(DEFAULT_DRAFT.postingMode);
    setScheduledDate(DEFAULT_DRAFT.scheduledDate);
    setScheduledTime(DEFAULT_DRAFT.scheduledTime);
    setAccountOptions(DEFAULT_DRAFT.accountOptions);
    setAccountOverrides(DEFAULT_DRAFT.accountOverrides);
  }, []);

  const value = useMemo<PostDraftContextValue>(
    () => ({
      message,
      media,
      selectedAccountIds,
      postingMode,
      scheduledDate,
      scheduledTime,
      accountOptions,
      accountOverrides,
      setMessage,
      setMedia,
      setSelectedAccountIds,
      setPostingMode,
      setScheduledDate,
      setScheduledTime,
      setAccountOptions,
      setAccountOverrides,
      updateAccountOverride,
      setAccountOverrideEnabled,
      setAccountOverrideMessage,
      setAccountOverrideMedia,
      resetDraft,
    }),
    [
      accountOptions,
      accountOverrides,
      message,
      media,
      postingMode,
      scheduledDate,
      scheduledTime,
      selectedAccountIds,
      setAccountOverrideEnabled,
      setAccountOverrideMedia,
      setAccountOverrideMessage,
      resetDraft,
      updateAccountOverride,
    ],
  );

  return <PostDraftContext.Provider value={value}>{children}</PostDraftContext.Provider>;
}

export function usePostDraft() {
  const context = useContext(PostDraftContext);
  if (!context) {
    throw new Error("usePostDraft must be used within PostDraftProvider");
  }
  return context;
}
