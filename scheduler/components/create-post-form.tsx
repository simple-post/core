"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { REPOST_CAPABLE_PLATFORMS } from "@simple-post/sdk/platform-names";
import { AlertTriangle, Info, Plus, Repeat2, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccounts } from "@/hooks/use-accounts";
import { useSubmitPost } from "@/hooks/use-mutations";
import { useRepostSettings } from "@/hooks/use-repost-settings";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import { logClientError } from "@/lib/logger/client";
import { getMainFieldCharCounterState } from "@/lib/message-length-ui";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ValidationResultByPlatform } from "@/lib/validation/post-validation";
import { getLocalScheduledDateTimeError, parseLocalScheduledDateTime } from "@/lib/validations/scheduled-time";
import type { AccountOptionsMap, AccountOverridesMap, MediaFile, PostingMode, ThreadSegment } from "@/types";

import { AccountOptionsComponent } from "./account-options";
import { AccountSelector } from "./account-selector";
import { GenericPostPreview } from "./generic-post-preview";
import { getClipboardImageFiles, MediaUpload, type MediaUploadHandle } from "./media-upload";
import { usePostDraft } from "./post-draft-context";
import { PostLinksModal } from "./post-links-modal";
import { ScheduleDateTimePicker } from "./schedule-date-time-picker";

import type { ValidationIssue } from "@simple-post/sdk";

type ValidationResponse = ValidationResultByPlatform;

const REPOST_CAPABLE_PLATFORM_IDS = new Set<string>([...REPOST_CAPABLE_PLATFORMS, "twitter"]);

function normalizeDelayHours(value: number) {
  if (!Number.isFinite(value)) return 12;
  return Math.min(720, Math.max(1, Math.round(value)));
}

export function CreatePostForm() {
  const router = useRouter();
  const submitPostMutation = useSubmitPost();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: defaultRepostSettings } = useRepostSettings();

  const {
    message,
    media,
    selectedAccountIds,
    postingMode,
    scheduledDate,
    scheduledTime,
    accountOptions,
    accountOverrides,
    repostSettings,
    thread,
    hasDraftContent,
    storageError,
    setMessage,
    setMedia,
    setSelectedAccountIds,
    setAccountOptions,
    setRepostSettings,
    setPostingMode,
    setScheduledDate,
    setScheduledTime,
    addThreadSegment,
    removeThreadSegment,
    updateThreadSegmentMessage,
    updateThreadSegmentMedia,
    resetDraft,
  } = usePostDraft();

  const mediaUploadRef = useRef<MediaUploadHandle | null>(null);
  const threadMediaUploadRefs = useRef<Array<MediaUploadHandle | null>>([]);
  const defaultRepostAppliedRef = useRef(false);
  const [showPostLinksModal, setShowPostLinksModal] = useState(false);
  const [postingResults, setPostingResults] = useState<
    Array<{
      accountId: string;
      platform: string;
      success: boolean;
      error?: string;
      postUrl?: string;
      threadResults?: Array<{ index: number; success: boolean; postId?: string; postUrl?: string }>;
    }>
  >([]);
  const [postingSucceeded, setPostingSucceeded] = useState(false);
  const [serverValidation, setServerValidation] = useState<ValidationResponse | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [accountOptionsBlocked, setAccountOptionsBlocked] = useState(false);
  const [tiktokConsent, setTikTokConsent] = useState(false);
  const [contentTouched, setContentTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const enabledOverrides = useMemo<AccountOverridesMap>(() => {
    if (selectedAccountIds.length === 0) {
      return {};
    }

    return selectedAccountIds.reduce((acc, accountId) => {
      const override = accountOverrides[accountId];
      if (override?.enabled) {
        acc[accountId] = {
          message: override.message,
          media: override.media,
        };
      }
      return acc;
    }, {} as AccountOverridesMap);
  }, [accountOverrides, selectedAccountIds]);

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedAccountIds.includes(account.id)),
    [accounts, selectedAccountIds],
  );
  const selectedTikTokAccounts = useMemo(
    () => selectedAccounts.filter((account) => account.platform.toLowerCase() === "tiktok"),
    [selectedAccounts],
  );
  const hasSelectedRepostCapableAccount = useMemo(
    () => selectedAccounts.some((account) => REPOST_CAPABLE_PLATFORM_IDS.has(account.platform.toLowerCase())),
    [selectedAccounts],
  );
  const hasSelectedTikTok = selectedTikTokAccounts.length > 0;
  const tiktokConsentRequired = hasSelectedTikTok && postingMode !== "draft";
  const hasTikTokBrandedContent = selectedTikTokAccounts.some((account) => {
    const accountOption = accountOptions[account.id] as Record<string, unknown> | undefined;
    return accountOption?.discloseBrandedContent === true;
  });

  useEffect(() => {
    if (!tiktokConsentRequired) {
      setTikTokConsent(false);
    }
  }, [tiktokConsentRequired]);

  useEffect(() => {
    setScheduleError(null);
  }, [postingMode, scheduledDate, scheduledTime]);

  useEffect(() => {
    if (defaultRepostAppliedRef.current || !defaultRepostSettings) {
      return;
    }

    if (!hasDraftContent) {
      setRepostSettings(defaultRepostSettings);
    }

    defaultRepostAppliedRef.current = true;
  }, [defaultRepostSettings, hasDraftContent, setRepostSettings]);

  const localValidation = useMemo<ValidationResponse | null>(() => {
    if (selectedAccountIds.length === 0 || selectedAccounts.length !== selectedAccountIds.length) {
      return null;
    }

    return validatePostForResolvedAccounts({
      message,
      media,
      accounts: selectedAccounts,
      accountOverrides: enabledOverrides,
      thread: thread.length > 0 ? thread : undefined,
    });
  }, [enabledOverrides, media, message, selectedAccountIds, selectedAccounts, thread]);

  useEffect(() => {
    setServerValidation(null);
    setValidationError(null);
  }, [localValidation]);

  const validation = serverValidation ?? localValidation;

  const runBackendValidation = useCallback(
    async (signal?: AbortSignal): Promise<ValidationResponse | null> => {
      if (selectedAccountIds.length === 0) {
        setServerValidation(null);
        setValidationError(null);
        return null;
      }

      setValidationLoading(true);
      try {
        const response = await fetch("/api/v1/validation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            media,
            accountIds: selectedAccountIds,
            accountOverrides: enabledOverrides,
            thread: thread.length > 0 ? thread : undefined,
          }),
          signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Validation failed");
        }

        const data = (await response.json()) as ValidationResponse;
        setServerValidation(data);
        setValidationError(null);
        return data;
      } catch (error) {
        if (signal?.aborted) {
          return null;
        }
        setValidationError(error instanceof Error ? error.message : "Validation failed");
        setServerValidation(null);
        return null;
      } finally {
        setValidationLoading(false);
      }
    },
    [enabledOverrides, media, message, selectedAccountIds, thread],
  );

  const maxTextLength = useMemo(() => {
    if (!validation) return undefined;

    const commonResults = validation.results.filter((result) => result.usesCommonContent);
    if (commonResults.length === 0) {
      return undefined;
    }

    const hasMedia = media.length > 0;
    const hasVideo = media.some((item) => item.type === "video");
    const hasImage = media.some((item) => item.type === "image");

    const limits = commonResults
      .map((result) => {
        const textRules = result.rules.text;
        if (!textRules) return undefined;

        if (hasMedia) {
          if (textRules.maxCaptionLengthByMediaType) {
            const candidates: number[] = [];
            if (hasVideo && textRules.maxCaptionLengthByMediaType.video) {
              candidates.push(textRules.maxCaptionLengthByMediaType.video);
            }
            if (hasImage && textRules.maxCaptionLengthByMediaType.image) {
              candidates.push(textRules.maxCaptionLengthByMediaType.image);
            }
            if (candidates.length > 0) {
              return Math.min(...candidates);
            }
          }
          return textRules.maxCaptionLength ?? textRules.maxLength;
        }

        return textRules.maxLength ?? textRules.maxCaptionLength;
      })
      .filter((limit): limit is number => typeof limit === "number");

    return limits.length > 0 ? Math.min(...limits) : undefined;
  }, [validation, media]);

  const charCounter = useMemo(
    () =>
      getMainFieldCharCounterState({
        messageLength: message.length,
        maxTextLength,
        validationResults: validation?.results ?? [],
        requireXCommonContent: true,
      }),
    [maxTextLength, message.length, validation?.results],
  );

  const hasComposedContent = useMemo(
    () =>
      message.trim().length > 0 ||
      media.length > 0 ||
      thread.some((segment) => segment.message.trim().length > 0 || (segment.media?.length ?? 0) > 0) ||
      Object.values(enabledOverrides).some(
        (override) => (override.message ?? "").trim().length > 0 || (override.media?.length ?? 0) > 0,
      ),
    [enabledOverrides, media.length, message, thread],
  );
  const shouldShowValidationFeedback =
    postingMode !== "draft" && (submitAttempted || contentTouched || hasComposedContent);
  const visibleValidationErrors = shouldShowValidationFeedback ? (validation?.summary.errors ?? []) : [];
  const visibleValidationWarnings = shouldShowValidationFeedback ? (validation?.summary.warnings ?? []) : [];

  const formattedIssue = (issue: ValidationIssue) => {
    const platform = getPlatformById(issue.platform)?.name || issue.platform.toUpperCase();
    const accountId =
      issue.meta && typeof issue.meta === "object" ? (issue.meta as { accountId?: string }).accountId : "";
    const account = validation?.accounts.find((acc) => acc.id === accountId);

    if (account) {
      return `${getAccountDisplayName(account)} (${platform}): ${issue.message}`;
    }

    return `${platform}: ${issue.message}`;
  };

  const handleMessagePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length > 0) {
      setContentTouched(true);
      void mediaUploadRef.current?.processFiles(imageFiles);
    }
  }, []);

  const handleThreadSegmentPaste = useCallback((index: number, event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length > 0) {
      setContentTouched(true);
      void threadMediaUploadRefs.current[index]?.processFiles(imageFiles);
    }
  }, []);

  const handleMessageChange = useCallback(
    (value: string) => {
      setContentTouched(true);
      setMessage(value);
    },
    [setMessage],
  );

  const handleMediaChange = useCallback(
    (nextMedia: MediaFile[]) => {
      if (nextMedia.length > 0 || media.length > 0) {
        setContentTouched(true);
      }
      setMedia(nextMedia);
    },
    [media.length, setMedia],
  );

  const handleAddThreadSegment = useCallback(() => {
    setContentTouched(true);
    addThreadSegment();
  }, [addThreadSegment]);

  const handleRemoveThreadSegment = useCallback(
    (index: number) => {
      setContentTouched(true);
      removeThreadSegment(index);
    },
    [removeThreadSegment],
  );

  const handleThreadSegmentMessageChange = useCallback(
    (index: number, value: string) => {
      setContentTouched(true);
      updateThreadSegmentMessage(index, value);
    },
    [updateThreadSegmentMessage],
  );

  const handleThreadSegmentMediaChange = useCallback(
    (index: number, nextMedia: MediaFile[]) => {
      if (nextMedia.length > 0 || (thread[index]?.media?.length ?? 0) > 0) {
        setContentTouched(true);
      }
      updateThreadSegmentMedia(index, nextMedia);
    },
    [thread, updateThreadSegmentMedia],
  );

  const resetDraftToDefaults = useCallback(() => {
    resetDraft();
    if (defaultRepostSettings) {
      setRepostSettings(defaultRepostSettings);
      defaultRepostAppliedRef.current = true;
    } else {
      defaultRepostAppliedRef.current = false;
    }
  }, [defaultRepostSettings, resetDraft, setRepostSettings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitAttempted(true);

    if (selectedAccountIds.length === 0) {
      return;
    }

    if (postingMode === "schedule" && (!scheduledDate || !scheduledTime)) {
      return;
    }

    if (postingMode === "schedule") {
      const nextScheduleError = getLocalScheduledDateTimeError(scheduledDate, scheduledTime);
      if (nextScheduleError) {
        setScheduleError(nextScheduleError);
        toast.error(nextScheduleError);
        return;
      }
    }

    try {
      if (postingMode !== "draft") {
        const latestValidation = await runBackendValidation();
        if (!latestValidation?.summary.isValid) {
          return;
        }
      }

      const body: {
        message: string;
        accountIds: string[];
        postingMode: PostingMode;
        scheduledFor?: string;
        accountOptions?: AccountOptionsMap;
        accountOverrides?: AccountOverridesMap;
        repost?: {
          enabled: boolean;
          delayHours: number;
        };
        media: MediaFile[];
        thread?: ThreadSegment[];
      } = {
        message: message.trim(),
        accountIds: selectedAccountIds,
        postingMode,
        media,
      };

      body.repost = {
        enabled: repostSettings.enabled,
        delayHours: normalizeDelayHours(repostSettings.delayHours),
      };

      if (postingMode === "schedule") {
        const scheduledFor = parseLocalScheduledDateTime(scheduledDate, scheduledTime);
        if (!scheduledFor) {
          setScheduleError("Choose a valid date and time before scheduling this post.");
          return;
        }
        body.scheduledFor = scheduledFor.toISOString();
      }

      const filteredAccountOptions = selectedAccountIds.reduce((acc, accountId) => {
        const options = accountOptions[accountId];
        if (options) {
          acc[accountId] = options;
        }
        return acc;
      }, {} as AccountOptionsMap);

      if (Object.keys(filteredAccountOptions).length > 0) {
        body.accountOptions = filteredAccountOptions;
      }

      if (Object.keys(enabledOverrides).length > 0) {
        body.accountOverrides = enabledOverrides;
      }

      if (thread.length > 0) {
        body.thread = thread;
      }

      const data = await submitPostMutation.mutateAsync({
        body,
        mode: "create",
      });

      if (postingMode === "now" && data.postingResults && Array.isArray(data.postingResults)) {
        setPostingResults(data.postingResults);

        const allSucceeded = data.postingResults.every((r: { success: boolean }) => r.success);
        setPostingSucceeded(allSucceeded);
        if (allSucceeded) {
          resetDraftToDefaults();
        }

        setShowPostLinksModal(true);
      } else if (postingMode === "draft") {
        resetDraftToDefaults();
        router.push("/?tab=drafts");
      } else {
        resetDraftToDefaults();
        router.push("/?tab=scheduled");
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to create post. Please try again.";
      if (postingMode === "schedule" && errorMessage.toLowerCase().includes("scheduled")) {
        setScheduleError(errorMessage);
      }
      logClientError(error, "Failed to create post", { postingMode, accountCount: selectedAccountIds.length });
      toast.error(errorMessage);
    }
  };

  const isFormValid =
    selectedAccountIds.length > 0 &&
    !accountsLoading &&
    selectedAccounts.length === selectedAccountIds.length &&
    (postingMode === "draft" || (validation?.summary.isValid ?? false)) &&
    (postingMode === "draft" || !validationLoading) &&
    (postingMode === "draft" || !accountOptionsBlocked) &&
    (!tiktokConsentRequired || tiktokConsent) &&
    (postingMode !== "schedule" || (scheduledDate && scheduledTime && !scheduleError));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!hasDraftContent}
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setContentTouched(false);
              setSubmitAttempted(false);
              resetDraftToDefaults();
              toast.success("Draft cleared");
            }}>
            <Trash2 className="h-3.5 w-3.5" />
            Clear all
          </Button>
        </div>

        <AccountSelector
          selectedAccountIds={selectedAccountIds}
          onSelectionChange={setSelectedAccountIds}
          title="Post to"
          showAdvancedButton
          getAdvancedHref={(accountId) => `/schedule/advanced/${accountId}`}
          layout="row"
        />

        <AccountOptionsComponent
          selectedAccountIds={selectedAccountIds}
          options={accountOptions}
          onOptionsChange={setAccountOptions}
          media={media}
          onBlockingChange={setAccountOptionsBlocked}
        />

        <div className="space-y-4">
          <div>
            <Label htmlFor="message" className="text-sm font-medium">
              Message
            </Label>
            <Textarea
              id="message"
              placeholder="What's on your mind?"
              value={message}
              onChange={(e) => handleMessageChange(e.target.value)}
              onPaste={handleMessagePaste}
              className="min-h-32 resize-none mt-2"
              maxLength={maxTextLength}
            />
            <div className="mt-1">
              <MediaUpload ref={mediaUploadRef} media={media} onMediaChange={handleMediaChange} compact />
            </div>
            {maxTextLength ? (
              <div className="mt-2 flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 text-xs">
                <span className={charCounter.countClassName}>
                  {message.length.toLocaleString()}/{charCounter.denominator.toLocaleString()}
                </span>
                {charCounter.showLongPostOnXHint ? <span className="text-muted-foreground">Long X post</span> : null}
              </div>
            ) : null}
          </div>

          {/* Thread segments */}
          {thread.length > 0 && (
            <div className="space-y-0">
              {thread.map((segment, index) => (
                <div key={index} className="flex gap-3">
                  <div className="flex flex-col items-center pt-1">
                    <div className="w-px bg-border flex-1" />
                  </div>
                  <div className="flex-1 space-y-2 pb-4 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">
                        Post {index + 2}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                        onClick={() => handleRemoveThreadSegment(index)}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Textarea
                      placeholder="Continue your thread…"
                      value={segment.message}
                      onChange={(e) => handleThreadSegmentMessageChange(index, e.target.value)}
                      onPaste={(event) => handleThreadSegmentPaste(index, event)}
                      className="min-h-20 resize-none text-sm"
                    />
                    <MediaUpload
                      ref={(node) => {
                        threadMediaUploadRefs.current[index] = node;
                      }}
                      media={segment.media ?? []}
                      onMediaChange={(m) => handleThreadSegmentMediaChange(index, m)}
                      compact
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2 text-muted-foreground"
            onClick={handleAddThreadSegment}>
            <Plus className="h-3.5 w-3.5" />
            Add to thread
          </Button>
        </div>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">When to Post</Label>
          </div>
          <RadioGroup value={postingMode} onValueChange={(value) => setPostingMode(value as PostingMode)}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="now" id="post-now" />
              <Label htmlFor="post-now" className="font-normal cursor-pointer">
                Post Now
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="schedule" id="post-schedule" />
              <Label htmlFor="post-schedule" className="font-normal cursor-pointer">
                Schedule for Later
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="draft" id="post-draft" />
              <Label htmlFor="post-draft" className="font-normal cursor-pointer">
                Save as Draft
              </Label>
            </div>
          </RadioGroup>
        </div>

        {postingMode === "schedule" && (
          <div className="space-y-2">
            <ScheduleDateTimePicker
              scheduledDate={scheduledDate}
              scheduledTime={scheduledTime}
              onScheduledDateChange={setScheduledDate}
              onScheduledTimeChange={setScheduledTime}
            />
            {scheduleError ? (
              <p role="alert" className="text-sm text-destructive">
                {scheduleError}
              </p>
            ) : null}
          </div>
        )}

        {hasSelectedRepostCapableAccount ? (
          <div className="grid grid-cols-3 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex items-center gap-2">
              <Repeat2 className="h-4 w-4 shrink-0 text-primary" />
              <Label htmlFor="auto-repost-create" className="text-sm font-medium">
                Auto-repost
              </Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="About auto-repost"
                    className="text-muted-foreground transition-colors hover:text-foreground">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Default from settings</TooltipContent>
              </Tooltip>
            </div>

            <div className="flex items-center justify-center gap-1.5">
              {repostSettings.enabled ? (
                <>
                  <span className="text-xs text-muted-foreground">after</span>
                  <NumberInput
                    id="auto-repost-delay-hours"
                    min={1}
                    max={720}
                    value={repostSettings.delayHours}
                    onChange={(value) => setRepostSettings({ ...repostSettings, delayHours: value })}
                    className="h-7 w-14 px-2"
                  />
                  <span className="text-xs text-muted-foreground">h</span>
                </>
              ) : null}
            </div>

            <div className="flex justify-end">
              <Switch
                id="auto-repost-create"
                checked={repostSettings.enabled}
                onCheckedChange={(checked) => setRepostSettings({ ...repostSettings, enabled: checked })}
              />
            </div>
          </div>
        ) : null}

        {tiktokConsentRequired && (
          <div className="rounded-lg border border-border bg-card p-3 text-sm space-y-2">
            <div className="flex items-start gap-2">
              <Checkbox
                id="tiktok-consent-create"
                checked={tiktokConsent}
                onCheckedChange={(checked) => setTikTokConsent(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="tiktok-consent-create" className="text-sm font-normal leading-relaxed cursor-pointer">
                {hasTikTokBrandedContent ? (
                  <>
                    By posting, you agree to TikTok&apos;s{" "}
                    <a
                      href="https://www.tiktok.com/legal/page/global/bc-policy/en"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2">
                      Branded Content Policy
                    </a>{" "}
                    and{" "}
                    <a
                      href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2">
                      Music Usage Confirmation
                    </a>
                    .
                  </>
                ) : (
                  <>
                    By posting, you agree to TikTok&apos;s{" "}
                    <a
                      href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2">
                      Music Usage Confirmation
                    </a>
                    .
                  </>
                )}
              </Label>
            </div>
            <p className="pl-6 text-xs text-muted-foreground">
              TikTok may take a few minutes to process your content before it is visible on your profile.
            </p>
          </div>
        )}

        <div className="flex gap-4 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              router.push("/");
            }}
            className="flex-1">
            Cancel
          </Button>
          <Button type="submit" disabled={!isFormValid || submitPostMutation.isPending} className="flex-1">
            {submitPostMutation.isPending
              ? postingMode === "now"
                ? "Posting..."
                : postingMode === "draft"
                  ? "Saving..."
                  : "Scheduling..."
              : postingMode === "draft"
                ? "Save Draft"
                : validationLoading
                  ? "Validating..."
                  : postingMode === "now"
                    ? "Post Now"
                    : "Schedule Post"}
          </Button>
        </div>
      </form>

      <div className="lg:sticky lg:top-24 self-start space-y-4">
        {/* Status Messages */}
        <div className="space-y-3">
          {storageError && (
            <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-sm">
              <div className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                <p className="font-medium">Draft is not being saved</p>
              </div>
              <p className="mt-1 text-muted-foreground">{storageError}</p>
            </div>
          )}

          {selectedAccountIds.length === 0 && (
            <div className="p-3 rounded-lg border border-border bg-card text-sm text-muted-foreground">
              Select at least one account to publish your content.
            </div>
          )}

          {shouldShowValidationFeedback && validationError && (
            <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-sm">
              <div className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                <p className="font-medium">Something went wrong</p>
              </div>
              <p className="mt-1 text-muted-foreground">{validationError}</p>
            </div>
          )}

          {visibleValidationErrors.length > 0 ? (
            <div className="p-3 rounded-lg border border-destructive/30 bg-destructive/10 text-sm space-y-1">
              <div className="flex items-center gap-1.5 text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                <p className="font-medium">Before you can post</p>
              </div>
              {visibleValidationErrors.map((issue, index) => (
                <p key={`${issue.code}-${index}`} className="text-muted-foreground">
                  {formattedIssue(issue)}
                </p>
              ))}
            </div>
          ) : null}

          {visibleValidationWarnings.length > 0 ? (
            <div className="p-3 rounded-lg border border-border bg-card text-sm space-y-1">
              <div className="flex items-center gap-1.5 text-foreground">
                <Info className="h-3.5 w-3.5" />
                <p className="font-medium">Tips</p>
              </div>
              {visibleValidationWarnings.map((issue, index) => (
                <p key={`${issue.code}-${index}`} className="text-muted-foreground">
                  {formattedIssue(issue)}
                </p>
              ))}
            </div>
          ) : null}
        </div>

        <GenericPostPreview message={message} media={media} thread={thread} />
      </div>

      <PostLinksModal
        open={showPostLinksModal}
        onOpenChange={(open) => {
          setShowPostLinksModal(open);
          if (!open && postingSucceeded) {
            router.push("/?tab=past");
          }
        }}
        results={postingResults}
      />
    </div>
  );
}
