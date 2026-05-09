"use client";

import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useSession } from "@/lib/auth/auth-client";
import type { AccountOptionsMap, MediaFile, PostingMode, ThreadSegment } from "@/types";

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
  postingMode: PostingMode;
  scheduledDate: string;
  scheduledTime: string;
  accountOptions: AccountOptionsMap;
  accountOverrides: DraftAccountOverridesMap;
  thread: ThreadSegment[];
}

interface PostDraftContextValue extends PostDraftState {
  hasDraftContent: boolean;
  storageError: string | null;
  setMessage: (value: string) => void;
  setMedia: (value: MediaFile[]) => void;
  setSelectedAccountIds: (value: string[]) => void;
  setPostingMode: (value: PostingMode) => void;
  setScheduledDate: (value: string) => void;
  setScheduledTime: (value: string) => void;
  setAccountOptions: (value: AccountOptionsMap) => void;
  setAccountOverrides: (value: DraftAccountOverridesMap) => void;
  updateAccountOverride: (accountId: string, updates: Partial<DraftAccountOverride>) => void;
  setAccountOverrideEnabled: (accountId: string, enabled: boolean) => void;
  setAccountOverrideMessage: (accountId: string, message: string) => void;
  setAccountOverrideMedia: (accountId: string, media: MediaFile[]) => void;
  setThread: (value: ThreadSegment[]) => void;
  addThreadSegment: () => void;
  removeThreadSegment: (index: number) => void;
  updateThreadSegmentMessage: (index: number, message: string) => void;
  updateThreadSegmentMedia: (index: number, media: MediaFile[]) => void;
  resetDraft: () => void;
}

const DEFAULT_DRAFT: PostDraftState = {
  message: "",
  media: [],
  selectedAccountIds: [],
  postingMode: "now",
  scheduledDate: "",
  scheduledTime: "",
  accountOptions: {},
  accountOverrides: {},
  thread: [],
};

const DRAFT_STORAGE_KEY_PREFIX = "simplepost:create-post-draft:v1";
const DRAFT_STORAGE_VERSION = 1;

interface StoredPostDraft {
  version: number;
  updatedAt: string;
  draft: PostDraftState;
}

const PostDraftContext = createContext<PostDraftContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPostingMode(value: unknown): value is PostingMode {
  return value === "now" || value === "schedule" || value === "draft";
}

function normalizeMedia(value: unknown): MediaFile[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): MediaFile | null => {
      if (!isRecord(item)) {
        return null;
      }

      const { id, url, thumbnailUrl, type, filename, size } = item;
      if (
        typeof id !== "string" ||
        typeof url !== "string" ||
        (type !== "image" && type !== "video") ||
        typeof filename !== "string" ||
        typeof size !== "number"
      ) {
        return null;
      }

      return {
        id,
        url,
        thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl : undefined,
        type,
        filename,
        size,
      };
    })
    .filter((item): item is MediaFile => item !== null);
}

function normalizeThread(value: unknown): ThreadSegment[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item): ThreadSegment | null => {
      if (!isRecord(item)) {
        return null;
      }

      const segment: ThreadSegment = {
        message: typeof item.message === "string" ? item.message : "",
      };
      const media = normalizeMedia(item.media);
      if (media.length > 0) {
        segment.media = media;
      }
      return segment;
    })
    .filter((item): item is ThreadSegment => item !== null);
}

function normalizeAccountOverrides(value: unknown): DraftAccountOverridesMap {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<DraftAccountOverridesMap>((acc, [accountId, override]) => {
    if (!isRecord(override)) {
      return acc;
    }

    acc[accountId] = {
      enabled: override.enabled === true,
      message: typeof override.message === "string" ? override.message : "",
      media: normalizeMedia(override.media),
    };
    return acc;
  }, {});
}

function normalizeStoredDraft(value: unknown): PostDraftState | null {
  const candidate = isRecord(value) && isRecord(value.draft) ? value.draft : value;
  if (!isRecord(candidate)) {
    return null;
  }

  return {
    message: typeof candidate.message === "string" ? candidate.message : DEFAULT_DRAFT.message,
    media: normalizeMedia(candidate.media),
    selectedAccountIds: Array.isArray(candidate.selectedAccountIds)
      ? candidate.selectedAccountIds.filter((id): id is string => typeof id === "string")
      : DEFAULT_DRAFT.selectedAccountIds,
    postingMode: isPostingMode(candidate.postingMode) ? candidate.postingMode : DEFAULT_DRAFT.postingMode,
    scheduledDate: typeof candidate.scheduledDate === "string" ? candidate.scheduledDate : DEFAULT_DRAFT.scheduledDate,
    scheduledTime: typeof candidate.scheduledTime === "string" ? candidate.scheduledTime : DEFAULT_DRAFT.scheduledTime,
    accountOptions: isRecord(candidate.accountOptions) ? (candidate.accountOptions as AccountOptionsMap) : {},
    accountOverrides: normalizeAccountOverrides(candidate.accountOverrides),
    thread: normalizeThread(candidate.thread),
  };
}

function hasPersistableDraft(draft: PostDraftState) {
  return (
    draft.message.length > 0 ||
    draft.media.length > 0 ||
    draft.selectedAccountIds.length > 0 ||
    draft.postingMode !== DEFAULT_DRAFT.postingMode ||
    draft.scheduledDate.length > 0 ||
    draft.scheduledTime.length > 0 ||
    Object.keys(draft.accountOptions).length > 0 ||
    Object.keys(draft.accountOverrides).length > 0 ||
    draft.thread.length > 0
  );
}

function createStoredDraft(draft: PostDraftState): StoredPostDraft {
  return {
    version: DRAFT_STORAGE_VERSION,
    updatedAt: new Date().toISOString(),
    draft,
  };
}

function getStorageErrorMessage(error: unknown) {
  if (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  ) {
    return "Draft could not be saved because browser storage is full.";
  }

  return "Draft could not be saved in this browser.";
}

export function PostDraftProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const storageKey = session?.user?.id ? `${DRAFT_STORAGE_KEY_PREFIX}:${session.user.id}` : null;
  const hydratedStorageKeyRef = useRef<string | null>(null);
  const draftRef = useRef<PostDraftState>(DEFAULT_DRAFT);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [message, setMessageState] = useState(DEFAULT_DRAFT.message);
  const [media, setMediaState] = useState<MediaFile[]>(DEFAULT_DRAFT.media);
  const [selectedAccountIds, setSelectedAccountIdsState] = useState<string[]>(DEFAULT_DRAFT.selectedAccountIds);
  const [postingMode, setPostingModeState] = useState<PostDraftState["postingMode"]>(DEFAULT_DRAFT.postingMode);
  const [scheduledDate, setScheduledDateState] = useState(DEFAULT_DRAFT.scheduledDate);
  const [scheduledTime, setScheduledTimeState] = useState(DEFAULT_DRAFT.scheduledTime);
  const [accountOptions, setAccountOptionsState] = useState<AccountOptionsMap>(DEFAULT_DRAFT.accountOptions);
  const [accountOverrides, setAccountOverridesState] = useState<DraftAccountOverridesMap>(
    DEFAULT_DRAFT.accountOverrides,
  );
  const [thread, setThreadState] = useState<ThreadSegment[]>(DEFAULT_DRAFT.thread);

  const setDraftState = useCallback((draft: PostDraftState) => {
    draftRef.current = draft;
    setMessageState(draft.message);
    setMediaState(draft.media);
    setSelectedAccountIdsState(draft.selectedAccountIds);
    setPostingModeState(draft.postingMode);
    setScheduledDateState(draft.scheduledDate);
    setScheduledTimeState(draft.scheduledTime);
    setAccountOptionsState(draft.accountOptions);
    setAccountOverridesState(draft.accountOverrides);
    setThreadState(draft.thread);
  }, []);

  const persistDraft = useCallback(
    (nextDraft: PostDraftState) => {
      if (!storageKey || hydratedStorageKeyRef.current !== storageKey) {
        return;
      }

      try {
        if (hasPersistableDraft(nextDraft)) {
          window.localStorage.setItem(storageKey, JSON.stringify(createStoredDraft(nextDraft)));
        } else {
          window.localStorage.removeItem(storageKey);
        }
        setStorageError(null);
      } catch (error) {
        setStorageError(getStorageErrorMessage(error));
      }
    },
    [storageKey],
  );

  const updateDraft = useCallback(
    (updates: Partial<PostDraftState>) => {
      const nextDraft = { ...draftRef.current, ...updates };
      setDraftState(nextDraft);
      persistDraft(nextDraft);
    },
    [persistDraft, setDraftState],
  );

  const setMessage = useCallback((value: string) => updateDraft({ message: value }), [updateDraft]);
  const setMedia = useCallback((value: MediaFile[]) => updateDraft({ media: value }), [updateDraft]);
  const setSelectedAccountIds = useCallback(
    (value: string[]) => updateDraft({ selectedAccountIds: value }),
    [updateDraft],
  );
  const setPostingMode = useCallback((value: PostingMode) => updateDraft({ postingMode: value }), [updateDraft]);
  const setScheduledDate = useCallback((value: string) => updateDraft({ scheduledDate: value }), [updateDraft]);
  const setScheduledTime = useCallback((value: string) => updateDraft({ scheduledTime: value }), [updateDraft]);
  const setAccountOptions = useCallback(
    (value: AccountOptionsMap) => updateDraft({ accountOptions: value }),
    [updateDraft],
  );
  const setAccountOverrides = useCallback(
    (value: DraftAccountOverridesMap) => updateDraft({ accountOverrides: value }),
    [updateDraft],
  );
  const setThread = useCallback((value: ThreadSegment[]) => updateDraft({ thread: value }), [updateDraft]);

  const draft = useMemo<PostDraftState>(
    () => ({
      message,
      media,
      selectedAccountIds,
      postingMode,
      scheduledDate,
      scheduledTime,
      accountOptions,
      accountOverrides,
      thread,
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
      thread,
    ],
  );

  const hasDraftContent = useMemo(() => hasPersistableDraft(draft), [draft]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    hydratedStorageKeyRef.current = null;

    try {
      const storedValue = window.localStorage.getItem(storageKey);
      if (!storedValue) {
        setDraftState(DEFAULT_DRAFT);
        setStorageError(null);
        hydratedStorageKeyRef.current = storageKey;
        return;
      }

      const parsed = JSON.parse(storedValue) as unknown;
      const storedDraft = normalizeStoredDraft(parsed);
      if (storedDraft) {
        setDraftState(storedDraft);
      } else {
        window.localStorage.removeItem(storageKey);
        setDraftState(DEFAULT_DRAFT);
      }
      setStorageError(null);
    } catch {
      setDraftState(DEFAULT_DRAFT);
      setStorageError("Draft could not be loaded from this browser.");
    } finally {
      hydratedStorageKeyRef.current = storageKey;
    }
  }, [setDraftState, storageKey]);

  const updateAccountOverride = useCallback(
    (accountId: string, updates: Partial<DraftAccountOverride>) => {
      const currentOverrides = draftRef.current.accountOverrides;
      const current = currentOverrides[accountId] || { enabled: false, message: "", media: [] };

      updateDraft({
        accountOverrides: {
          ...currentOverrides,
          [accountId]: {
            ...current,
            ...updates,
          },
        },
      });
    },
    [updateDraft],
  );

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

  const addThreadSegment = useCallback(() => {
    updateDraft({ thread: [...draftRef.current.thread, { message: "" }] });
  }, [updateDraft]);

  const removeThreadSegment = useCallback(
    (index: number) => {
      updateDraft({ thread: draftRef.current.thread.filter((_, i) => i !== index) });
    },
    [updateDraft],
  );

  const updateThreadSegmentMessage = useCallback(
    (index: number, segmentMessage: string) => {
      updateDraft({
        thread: draftRef.current.thread.map((seg, i) => (i === index ? { ...seg, message: segmentMessage } : seg)),
      });
    },
    [updateDraft],
  );

  const updateThreadSegmentMedia = useCallback(
    (index: number, segmentMedia: MediaFile[]) => {
      updateDraft({
        thread: draftRef.current.thread.map((seg, i) => (i === index ? { ...seg, media: segmentMedia } : seg)),
      });
    },
    [updateDraft],
  );

  const resetDraft = useCallback(() => {
    if (storageKey) {
      try {
        window.localStorage.removeItem(storageKey);
        setStorageError(null);
      } catch (error) {
        setStorageError(getStorageErrorMessage(error));
      }
    }

    setDraftState(DEFAULT_DRAFT);
  }, [setDraftState, storageKey]);

  const value = useMemo<PostDraftContextValue>(
    () => ({
      hasDraftContent,
      storageError,
      message,
      media,
      selectedAccountIds,
      postingMode,
      scheduledDate,
      scheduledTime,
      accountOptions,
      accountOverrides,
      thread,
      setMessage,
      setMedia,
      setSelectedAccountIds,
      setPostingMode,
      setScheduledDate,
      setScheduledTime,
      setAccountOptions,
      setAccountOverrides,
      setThread,
      updateAccountOverride,
      setAccountOverrideEnabled,
      setAccountOverrideMessage,
      setAccountOverrideMedia,
      addThreadSegment,
      removeThreadSegment,
      updateThreadSegmentMessage,
      updateThreadSegmentMedia,
      resetDraft,
    }),
    [
      accountOptions,
      accountOverrides,
      hasDraftContent,
      message,
      media,
      postingMode,
      scheduledDate,
      scheduledTime,
      selectedAccountIds,
      storageError,
      thread,
      setMessage,
      setMedia,
      setSelectedAccountIds,
      setPostingMode,
      setScheduledDate,
      setScheduledTime,
      setAccountOptions,
      setAccountOverrides,
      setThread,
      updateAccountOverride,
      setAccountOverrideEnabled,
      setAccountOverrideMedia,
      setAccountOverrideMessage,
      resetDraft,
      addThreadSegment,
      removeThreadSegment,
      updateThreadSegmentMessage,
      updateThreadSegmentMedia,
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
