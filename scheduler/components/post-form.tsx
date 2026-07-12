"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { format } from "date-fns";
import { AlertCircle, Info, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAccounts } from "@/hooks/use-accounts";
import { useSubmitPost } from "@/hooks/use-mutations";
import { usePost } from "@/hooks/use-posts";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import { logClientError } from "@/lib/logger/client";
import { getMainFieldCharCounterState } from "@/lib/message-length-ui";
import {
  failPendingPostingResults,
  mergePostingProgressResult,
  mergePostingProgressResults,
} from "@/lib/posting/progress-client";
import type { PostingProgressResult } from "@/lib/posting/progress-client";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ValidationResultByPlatform } from "@/lib/validation/post-validation";
import { getLocalScheduledDateTimeError, parseLocalScheduledDateTime } from "@/lib/validations/scheduled-time";
import type {
  AccountOptionsMap,
  AccountOverridesMap,
  MediaFile,
  PostingMode,
  SocialPost,
  ThreadSegment,
} from "@/types";

import { AccountOptionsComponent } from "./account-options";
import { AccountSelector } from "./account-selector";
import { CreatePostForm } from "./create-post-form";
import { getClipboardImageFiles, MediaUpload, type MediaUploadHandle } from "./media-upload";
import { PostLinksModal } from "./post-links-modal";
import { PostPreview } from "./post-preview";
import { QuotePostCard } from "./quote-post-card";
import { SchedulePicker } from "./schedule-picker";

import type { ValidationIssue } from "@simple-post/sdk";

interface PostFormProps {
  mode: "create" | "edit" | "retry";
  existingPost?: SocialPost;
}

type ValidationResponse = ValidationResultByPlatform;

export function PostForm({ mode, existingPost }: PostFormProps) {
  if (mode === "create") {
    return <CreatePostForm />;
  }

  if (!existingPost) {
    return null;
  }

  return <EditPostForm existingPost={existingPost} mode={mode} />;
}

function normalizeDelayHours(value: number | undefined) {
  if (!Number.isFinite(value)) return 12;
  return Math.min(720, Math.max(1, Math.round(value ?? 12)));
}

function getFailedRetryAccountIds(post: SocialPost): string[] {
  const originalAccountIds = new Set(post.accountIds);
  const failedFromAccountResults = Object.values(post.accountResults ?? {})
    .filter((result) => !result.success && originalAccountIds.has(result.accountId))
    .map((result) => result.accountId);

  if (failedFromAccountResults.length > 0) {
    return [...new Set(failedFromAccountResults)];
  }

  const failedPlatforms = Array.isArray(post.errorDetails?.failedPlatforms)
    ? (post.errorDetails.failedPlatforms as Array<{ accountId?: unknown; platform?: unknown }>)
    : [];
  const failedAccountIds = failedPlatforms
    .map((failure) => (typeof failure.accountId === "string" ? failure.accountId : null))
    .filter((accountId): accountId is string => accountId !== null && originalAccountIds.has(accountId));

  if (failedAccountIds.length > 0) {
    return [...new Set(failedAccountIds)];
  }

  return post.accountIds;
}

function EditPostForm({ existingPost, mode }: { existingPost: SocialPost; mode: "edit" | "retry" }) {
  const isRetry = mode === "retry";
  const router = useRouter();
  const [message, setMessage] = useState(existingPost.message || "");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(
    isRetry ? getFailedRetryAccountIds(existingPost) : existingPost.accountIds || [],
  );
  const [postingMode, setPostingMode] = useState<PostingMode>(
    isRetry ? "now" : existingPost.status === "draft" ? "draft" : "schedule",
  );
  const [scheduledDate, setScheduledDate] = useState(
    !isRetry && existingPost.scheduledFor ? format(existingPost.scheduledFor, "yyyy-MM-dd") : "",
  );
  const [scheduledTime, setScheduledTime] = useState(
    !isRetry && existingPost.scheduledFor ? format(existingPost.scheduledFor, "HH:mm") : "",
  );
  const [media, setMedia] = useState<MediaFile[]>(existingPost.media || []);
  const [thread, setThread] = useState<ThreadSegment[]>(existingPost.thread || []);
  const [accountOptions, setAccountOptions] = useState<AccountOptionsMap>(existingPost.accountOptions || {});
  const [accountOverrides] = useState<AccountOverridesMap>(existingPost.accountOverrides || {});
  const [quotePostId, setQuotePostId] = useState<string | null>(existingPost.quotePostId ?? null);
  const [showPostLinksModal, setShowPostLinksModal] = useState(false);
  const [postingResults, setPostingResults] = useState<PostingProgressResult[]>([]);
  const [postingSucceeded, setPostingSucceeded] = useState(false);
  const [serverValidation, setServerValidation] = useState<ValidationResponse | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [accountOptionsBlocked, setAccountOptionsBlocked] = useState(false);
  const [tiktokConsent, setTikTokConsent] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const mediaUploadRef = useRef<MediaUploadHandle | null>(null);
  const threadMediaUploadRefs = useRef<Array<MediaUploadHandle | null>>([]);

  const submitPostMutation = useSubmitPost();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: quotePost, isLoading: quotePostLoading, isError: quotePostError } = usePost(quotePostId ?? "");

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedAccountIds.includes(account.id)),
    [accounts, selectedAccountIds],
  );
  const selectedAccountIdSet = useMemo(() => new Set(selectedAccountIds), [selectedAccountIds]);
  const enabledOverrides = useMemo<AccountOverridesMap>(
    () =>
      Object.fromEntries(
        Object.entries(accountOverrides).filter(([accountId]) => selectedAccountIdSet.has(accountId)),
      ) as AccountOverridesMap,
    [accountOverrides, selectedAccountIdSet],
  );
  const selectedTikTokAccounts = useMemo(
    () => selectedAccounts.filter((account) => account.platform.toLowerCase() === "tiktok"),
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
      accountOptions,
    });
  }, [accountOptions, enabledOverrides, media, message, selectedAccountIds, selectedAccounts, thread]);

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
            accountOptions,
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
    [accountOptions, enabledOverrides, media, message, selectedAccountIds, thread],
  );

  const maxTextLength = useMemo(() => {
    if (!validation) return undefined;

    const hasMedia = media.length > 0;
    const hasVideo = media.some((item) => item.type === "video");
    const hasImage = media.some((item) => item.type === "image");

    const limits = validation.results
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
        requireXCommonContent: false,
      }),
    [maxTextLength, message.length, validation?.results],
  );

  const formattedIssue = (issue: ValidationIssue) => {
    const platform = getPlatformById(issue.platform)?.name || issue.platform.toUpperCase();
    return `${platform}: ${issue.message}`;
  };

  const handleMessagePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length > 0) {
      void mediaUploadRef.current?.processFiles(imageFiles);
    }
  }, []);

  const handleThreadSegmentPaste = useCallback((index: number, event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = getClipboardImageFiles(event.clipboardData);
    if (imageFiles.length > 0) {
      void threadMediaUploadRefs.current[index]?.processFiles(imageFiles);
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate based on posting mode
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

    if (postingMode === "now") {
      setPostingResults(
        selectedAccounts.map((account) => ({
          accountId: account.id,
          platform: account.platform,
          accountName: getAccountDisplayName(account),
        })),
      );
      setPostingSucceeded(false);
      setShowPostLinksModal(true);
    }

    try {
      if (postingMode !== "draft") {
        const latestValidation = await runBackendValidation();
        if (!latestValidation?.summary.isValid) {
          if (postingMode === "now") {
            setShowPostLinksModal(false);
            setPostingResults([]);
          }
          return;
        }
      }

      // Build the request body - media is already uploaded to R2
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
        quotePostId?: string | null;
      } = {
        message: message.trim(),
        accountIds: selectedAccountIds,
        postingMode,
        media, // Already contains R2 URLs
      };

      // Only add schedule info if scheduling
      if (postingMode === "schedule") {
        const scheduledFor = parseLocalScheduledDateTime(scheduledDate, scheduledTime);
        if (!scheduledFor) {
          setScheduleError("Choose a valid date and time before scheduling this post.");
          return;
        }
        body.scheduledFor = scheduledFor.toISOString();
      }

      if (Object.keys(accountOptions).length > 0) {
        body.accountOptions = selectedAccountIds.reduce((acc, accountId) => {
          const options = accountOptions[accountId];
          if (options) {
            acc[accountId] = options;
          }
          return acc;
        }, {} as AccountOptionsMap);
      }

      if (Object.keys(enabledOverrides).length > 0) {
        body.accountOverrides = enabledOverrides;
      }

      if (thread.length > 0) {
        body.thread = thread;
      }

      if (isRetry) {
        body.repost = {
          enabled: existingPost.repostEnabled === true,
          delayHours: normalizeDelayHours(existingPost.repostDelayHours),
        };
        if (quotePostId) {
          body.quotePostId = quotePostId;
        }
      } else if (quotePostId !== (existingPost.quotePostId ?? null)) {
        body.quotePostId = quotePostId;
      }

      // Submit using mutation
      const data = await submitPostMutation.mutateAsync({
        body,
        mode: isRetry ? "create" : "edit",
        postId: isRetry ? undefined : existingPost.id,
        onPostingResult:
          postingMode === "now"
            ? (result) => {
                setPostingResults((current) => mergePostingProgressResult(current, result));
              }
            : undefined,
      });

      // If posting now and we have posting results, show the modal
      if (postingMode === "now" && data.postingResults && Array.isArray(data.postingResults)) {
        const completedResults = data.postingResults;
        setPostingResults((current) => mergePostingProgressResults(current, completedResults));

        // Check if all posts succeeded
        const allSucceeded = completedResults.every((result) => result.success);
        setPostingSucceeded(allSucceeded);

        setShowPostLinksModal(true);
        // Navigation will happen when modal closes (see onOpenChange below)
        // If failed, user can close modal and retry
      } else {
        if (isRetry) {
          router.push(postingMode === "draft" ? "/?tab=drafts" : "/?tab=scheduled");
        } else {
          router.push(postingMode === "draft" ? "/?tab=drafts" : "/?tab=scheduled");
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `Failed to ${isRetry ? "retry" : mode} post.`;
      if (postingMode === "schedule" && errorMessage.toLowerCase().includes("scheduled")) {
        setScheduleError(errorMessage);
      }
      if (postingMode === "now") {
        setPostingSucceeded(false);
        setPostingResults((current) => failPendingPostingResults(current, errorMessage));
      }
      logClientError(error, `Failed to ${isRetry ? "retry" : mode} post`, {
        postId: existingPost.id,
        postingMode,
        accountCount: selectedAccountIds.length,
      });
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
        {quotePostId ? (
          <QuotePostCard
            sourcePost={quotePost}
            isLoading={quotePostLoading}
            isError={quotePostError}
            selectedPlatforms={selectedAccounts.map((account) => account.platform)}
            onRemove={() => setQuotePostId(null)}
          />
        ) : null}

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
              onChange={(e) => setMessage(e.target.value)}
              onPaste={handleMessagePaste}
              className="min-h-32 resize-none mt-2"
              maxLength={maxTextLength}
            />
            <div className="mt-1">
              <MediaUpload ref={mediaUploadRef} media={media} onMediaChange={setMedia} compact />
            </div>
            <div className="mt-2 flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 text-xs">
              {maxTextLength ? (
                <>
                  <span className={charCounter.countClassName}>
                    {message.length.toLocaleString()}/{charCounter.denominator.toLocaleString()}
                  </span>
                  {charCounter.showLongPostOnXHint ? <span className="text-muted-foreground">Long X post</span> : null}
                </>
              ) : (
                <span className="text-muted-foreground">{message.length.toLocaleString()}</span>
              )}
            </div>
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
                        onClick={() => setThread((prev) => prev.filter((_, i) => i !== index))}>
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Textarea
                      placeholder="Continue your thread…"
                      value={segment.message}
                      onChange={(e) => {
                        const msg = e.target.value;
                        setThread((prev) => prev.map((s, i) => (i === index ? { ...s, message: msg } : s)));
                      }}
                      onPaste={(event) => handleThreadSegmentPaste(index, event)}
                      className="min-h-20 resize-none text-sm"
                    />
                    <MediaUpload
                      ref={(node) => {
                        threadMediaUploadRefs.current[index] = node;
                      }}
                      media={segment.media ?? []}
                      onMediaChange={(m) =>
                        setThread((prev) => prev.map((s, i) => (i === index ? { ...s, media: m } : s)))
                      }
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
            onClick={() => setThread((prev) => [...prev, { message: "" }])}>
            <Plus className="h-3.5 w-3.5" />
            Add to thread
          </Button>

          {/* Validation Feedback */}
          {/* Validation loading is shown in the submit button to avoid layout shift */}
          {validationError && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Validation failed</AlertTitle>
              <AlertDescription>
                <p>{validationError}</p>
              </AlertDescription>
            </Alert>
          )}
          {validation?.summary.errors.length ? (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Errors</AlertTitle>
              <AlertDescription>
                {validation.summary.errors.map((issue, index) => (
                  <p key={`${issue.code}-${index}`}>{formattedIssue(issue)}</p>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}
          {validation?.summary.warnings.length ? (
            <Alert>
              <Info />
              <AlertTitle>Warnings</AlertTitle>
              <AlertDescription>
                {validation.summary.warnings.map((issue, index) => (
                  <p key={`${issue.code}-${index}`}>{formattedIssue(issue)}</p>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}
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
            <SchedulePicker
              scheduledDate={scheduledDate}
              scheduledTime={scheduledTime}
              onScheduledDateChange={setScheduledDate}
              onScheduledTimeChange={setScheduledTime}
              excludePostId={existingPost.id}
            />
            {scheduleError ? (
              <p role="alert" className="text-sm text-destructive">
                {scheduleError}
              </p>
            ) : null}
          </div>
        )}

        {tiktokConsentRequired && (
          <div className="rounded-lg border border-border bg-card p-3 text-sm space-y-2">
            <div className="flex items-start gap-2">
              <Checkbox
                id="tiktok-consent-edit"
                checked={tiktokConsent}
                onCheckedChange={(checked) => setTikTokConsent(checked === true)}
                className="mt-0.5"
              />
              <Label htmlFor="tiktok-consent-edit" className="text-sm font-normal leading-relaxed cursor-pointer">
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

        {/* Submit Button */}
        <div className="flex gap-4 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              router.push(`/posts/${existingPost.id}`);
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
                  : isRetry
                    ? "Scheduling..."
                    : mode === "edit"
                      ? "Updating..."
                      : "Scheduling..."
              : postingMode === "draft"
                ? "Save Draft"
                : validationLoading
                  ? "Validating..."
                  : postingMode === "now"
                    ? "Post Now"
                    : isRetry
                      ? "Schedule Post"
                      : mode === "edit"
                        ? "Update Post"
                        : "Schedule Post"}
          </Button>
        </div>
      </form>

      <div className="lg:sticky lg:top-24 self-start">
        <PostPreview
          message={message}
          media={media}
          scheduledDate={scheduledDate}
          scheduledTime={scheduledTime}
          selectedPlatforms={selectedAccountIds}
          thread={thread}
        />
      </div>

      <PostLinksModal
        open={showPostLinksModal}
        posting={submitPostMutation.isPending}
        onOpenChange={(open) => {
          setShowPostLinksModal(open);
          // Navigate when modal is closed
          if (!open && postingSucceeded) {
            router.push("/?tab=past");
          }
          // If posting failed, stay on the page to let user retry
        }}
        results={postingResults}
      />
    </div>
  );
}
