"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { Feature } from "@prisma/client";
import { canFitImageIssue } from "@simple-post/sdk/image-fit";
import { AlertCircle, Info } from "lucide-react";
import { toast } from "sonner";

import { TrialLimitNotice, useTrialPostAllowance } from "@/components/billing/trial-post-allowance";
import { HelpLink } from "@/components/help-link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { PlatformPostPreview } from "@/features/platform-preview";
import { useAccounts } from "@/hooks/use-accounts";
import { useFeatures } from "@/hooks/use-features";
import { useSubmitPost } from "@/hooks/use-mutations";
import { usePost } from "@/hooks/use-posts";
import { getAccountDisplayName } from "@/lib/config";
import { logClientError } from "@/lib/logger/client";
import { getMainFieldCharCounterState, getMaxTextLength } from "@/lib/message-length-ui";
import {
  failPendingPostingResults,
  mergePostingProgressResult,
  mergePostingProgressResults,
} from "@/lib/posting/progress-client";
import type { PostingProgressResult } from "@/lib/posting/progress-client";
import { longestThreadLength } from "@/lib/posting/thread-length";
import { hasImageContent } from "@/lib/validation/image-content";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ValidationResultByPlatform } from "@/lib/validation/post-validation";
import {
  getDraftScheduledFor,
  getLocalScheduledDateTimeError,
  parseLocalScheduledDateTime,
} from "@/lib/validations/scheduled-time";
import type {
  AccountOptionsMap,
  AccountOverridesMap,
  MediaFile,
  PostingMode,
  SocialPost,
  ThreadSegment,
} from "@/types";

import { AccountSelector } from "./account-selector";
import { CreatePostForm } from "./create-post-form";
import { type ExistingPostMode, normalizeDelayHours } from "./edit-post-draft";
import { ImageFitReview } from "./image-fit-review";
import { PostContentEditor } from "./post-content-editor";
import { usePostDraft } from "./post-draft-context";
import { PostLinksModal } from "./post-links-modal";
import { QuotePostCard } from "./quote-post-card";
import { SchedulePicker } from "./schedule-picker";
import { TikTokSettings } from "./tiktok-settings";
import { ValidationIssueList } from "./validation-issue-list";

interface PostFormProps {
  mode: "create" | "duplicate" | "edit" | "retry";
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

/**
 * Edits, retries, or duplicates an existing post. Its content lives in the
 * route layout's PostDraftProvider, so the per-account customize page shares
 * it and navigating there and back keeps every change.
 */
function EditPostForm({ existingPost, mode }: { existingPost: SocialPost; mode: ExistingPostMode }) {
  const isRetry = mode === "retry";
  const isDuplicate = mode === "duplicate";
  const isCreating = isDuplicate;
  const router = useRouter();
  const {
    message,
    media,
    selectedAccountIds,
    postingMode,
    scheduledDate,
    scheduledTime,
    accountOptions,
    accountOverrides,
    thread,
    quotePostId,
    setMessage,
    setMedia,
    setSelectedAccountIds,
    setPostingMode,
    setScheduledDate,
    setScheduledTime,
    setAccountOptions,
    setAccountOverrideMedia,
    setAccountOverrideThread,
    setThread,
    setQuotePostId,
    addThreadSegment,
    removeThreadSegment,
    updateThreadSegmentMessage,
    updateThreadSegmentMedia,
  } = usePostDraft();
  const [showPostLinksModal, setShowPostLinksModal] = useState(false);
  const [postingResults, setPostingResults] = useState<PostingProgressResult[]>([]);
  const [postingSucceeded, setPostingSucceeded] = useState(false);
  const [serverValidation, setServerValidation] = useState<ValidationResponse | null>(null);
  const [showImageFit, setShowImageFit] = useState(false);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [tiktokConsent, setTikTokConsent] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const submitPostMutation = useSubmitPost();
  const { hasFeature } = useFeatures();
  const imageFittingEnabled = hasFeature(Feature.IMAGE_FITTING);
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: quotePost, isLoading: quotePostLoading, isError: quotePostError } = usePost(quotePostId ?? "");

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedAccountIds.includes(account.id)),
    [accounts, selectedAccountIds],
  );
  const enabledOverrides = useMemo<AccountOverridesMap>(
    () =>
      selectedAccountIds.reduce((acc, accountId) => {
        const override = accountOverrides[accountId];
        if (override?.enabled) {
          acc[accountId] = {
            message: override.message,
            media: override.media,
            ...(override.thread ? { thread: override.thread } : {}),
          };
        }
        return acc;
      }, {} as AccountOverridesMap),
    [accountOverrides, selectedAccountIds],
  );
  const shouldPreflightImages = useMemo(
    () =>
      hasImageContent({
        media,
        accountOptions,
        accountOverrides: enabledOverrides,
        thread,
      }),
    [accountOptions, enabledOverrides, media, thread],
  );
  const selectedTikTokAccounts = useMemo(
    () => selectedAccounts.filter((account) => account.platform.toLowerCase() === "tiktok"),
    [selectedAccounts],
  );
  const hasSelectedTikTok = selectedTikTokAccounts.length > 0;
  const tiktokConsentRequired = hasSelectedTikTok && postingMode !== "draft";

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
      accountOptions,
      accountOverrides: enabledOverrides,
      thread: thread.length > 0 ? thread : undefined,
    });
  }, [accountOptions, enabledOverrides, media, message, selectedAccountIds, selectedAccounts, thread]);

  useEffect(() => {
    setServerValidation(null);
    setValidationError(null);
  }, [localValidation]);

  const validation = serverValidation ?? localValidation;

  const runBackendValidation = useCallback(
    async (signal?: AbortSignal, mediaPreflight = false): Promise<ValidationResponse | null> => {
      if (selectedAccountIds.length === 0) {
        setServerValidation(null);
        setValidationError(null);
        return null;
      }

      setValidationLoading(true);
      try {
        const response = await fetch(`/api/v1/validation${mediaPreflight ? "?mediaPreflight=1" : ""}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            media,
            accountIds: selectedAccountIds,
            accountOptions,
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
    [accountOptions, enabledOverrides, media, message, selectedAccountIds, thread],
  );

  useEffect(() => {
    if (
      (postingMode === "draft" && !imageFittingEnabled) ||
      !shouldPreflightImages ||
      selectedAccountIds.length === 0 ||
      selectedAccounts.length !== selectedAccountIds.length
    ) {
      setValidationLoading(false);
      return;
    }

    const controller = new AbortController();
    setValidationLoading(true);
    const timeout = window.setTimeout(() => void runBackendValidation(controller.signal, true), 500);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    imageFittingEnabled,
    postingMode,
    runBackendValidation,
    selectedAccountIds.length,
    selectedAccounts.length,
    shouldPreflightImages,
  ]);

  const maxTextLength = useMemo(
    () =>
      getMaxTextLength(
        (validation?.results ?? []).filter((result) => result.usesCommonContent),
        media,
      ),
    [validation, media],
  );

  const charCounter = useMemo(
    () =>
      getMainFieldCharCounterState({
        message,
        maxTextLength,
        validationResults: validation?.results ?? [],
        requireXCommonContent: true,
      }),
    [maxTextLength, message, validation?.results],
  );

  const canOfferImageFitting =
    imageFittingEnabled &&
    [...(validation?.summary.errors ?? []), ...(validation?.summary.warnings ?? [])].some((issue) =>
      canFitImageIssue(issue),
    );
  const draftImageFittingRequired =
    postingMode === "draft" &&
    imageFittingEnabled &&
    (validation?.summary.errors ?? []).some((issue) => canFitImageIssue(issue));

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
      if (postingMode !== "draft" || (imageFittingEnabled && shouldPreflightImages)) {
        const latestValidation = await runBackendValidation(undefined, postingMode === "draft");
        const blockedByValidation =
          !latestValidation ||
          (postingMode === "draft"
            ? latestValidation.summary.errors.some((issue) => canFitImageIssue(issue))
            : !latestValidation.summary.isValid);
        if (blockedByValidation) {
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

      if (isCreating) {
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
        mode: isCreating ? "create" : "edit",
        postId: isCreating ? undefined : existingPost.id,
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
        router.push(postingMode === "draft" ? "/?tab=drafts" : "/?tab=scheduled");
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

  // Duplicate and retry create a new post, so they always charge the trial.
  // A plain edit only charges when it takes the post out of draft state —
  // an already scheduled post was charged when it was created.
  const trialAllowance = useTrialPostAllowance({
    platforms: selectedAccounts.map((account) => account.platform),
    threadSegments: longestThreadLength(selectedAccountIds, thread, enabledOverrides),
    isDraft: postingMode === "draft" || (!isCreating && existingPost.status !== "draft"),
  });

  const scheduledForPreview = useMemo(
    () => getDraftScheduledFor(postingMode, scheduledDate, scheduledTime),
    [postingMode, scheduledDate, scheduledTime],
  );

  const isFormValid =
    selectedAccountIds.length > 0 &&
    !accountsLoading &&
    selectedAccounts.length === selectedAccountIds.length &&
    (postingMode === "draft" ? !draftImageFittingRequired : (validation?.summary.isValid ?? false)) &&
    (postingMode !== "draft" || !imageFittingEnabled || !shouldPreflightImages || !validationLoading) &&
    (postingMode === "draft" || !validationLoading) &&
    (!tiktokConsentRequired || tiktokConsent) &&
    !trialAllowance.blocked &&
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
          getAdvancedHref={(accountId) =>
            `/posts/${existingPost.id}/${isDuplicate ? "duplicate" : "edit"}/advanced/${accountId}`
          }
          layout="row"
        />

        <div className="space-y-4">
          <PostContentEditor
            id="message"
            message={message}
            onMessageChange={setMessage}
            media={media}
            onMediaChange={setMedia}
            maxTextLength={maxTextLength}
            charCounter={charCounter}
            thread={{
              segments: thread,
              onAdd: addThreadSegment,
              onRemove: removeThreadSegment,
              onMessageChange: updateThreadSegmentMessage,
              onMediaChange: updateThreadSegmentMedia,
              maxThreadSegments: trialAllowance.maxThreadSegments,
            }}
          />

          {/* Validation Feedback */}
          {/* Validation loading is shown in the submit button to avoid layout shift */}
          {imageFittingEnabled && showImageFit && (
            <ImageFitReview
              content={{ media, accountOptions, accountOverrides: enabledOverrides, thread }}
              accountIds={selectedAccountIds}
              message={message}
              onClose={() => setShowImageFit(false)}
              onApply={(fitted) => {
                setMedia(fitted.media);
                if (fitted.accountOptions) setAccountOptions(fitted.accountOptions);
                for (const [id, override] of Object.entries(fitted.accountOverrides ?? {})) {
                  if (override.media) setAccountOverrideMedia(id, override.media);
                  if (override.thread) setAccountOverrideThread(id, override.thread);
                }
                if (fitted.thread) setThread(fitted.thread);
                setShowImageFit(false);
                setServerValidation(null);
              }}
            />
          )}
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
              <AlertTitle>Before you can post</AlertTitle>
              <AlertDescription>
                {canOfferImageFitting && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowImageFit(true)}>
                    Fit images…
                  </Button>
                )}
                <ValidationIssueList issues={validation.summary.errors} accounts={validation.accounts} />
              </AlertDescription>
            </Alert>
          ) : null}
          {validation?.summary.warnings.length ? (
            <Alert>
              <Info />
              <AlertTitle>Tips</AlertTitle>
              <AlertDescription>
                {canOfferImageFitting && validation.summary.errors.length === 0 && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowImageFit(true)}>
                    Fit images…
                  </Button>
                )}
                <ValidationIssueList issues={validation.summary.warnings} accounts={validation.accounts} />
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
            <HelpLink path="/scheduling#timezones">Scheduling and timezone help</HelpLink>
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

        {hasSelectedTikTok ? (
          <TikTokSettings
            accounts={selectedTikTokAccounts}
            accountOptions={accountOptions}
            onAccountOptionsChange={setAccountOptions}
            consent={
              tiktokConsentRequired
                ? { id: "tiktok-consent-edit", checked: tiktokConsent, onCheckedChange: setTikTokConsent }
                : undefined
            }
            shouldApplyInteractionDefaults={(accountId) => isDuplicate || !existingPost.accountIds.includes(accountId)}
          />
        ) : null}

        <TrialLimitNotice allowance={trialAllowance} />

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
        <PlatformPostPreview
          message={message}
          media={media}
          selectedAccounts={selectedAccounts}
          accountOptions={accountOptions}
          accountOverrides={accountOverrides}
          thread={thread}
          previewDate={scheduledForPreview}
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
