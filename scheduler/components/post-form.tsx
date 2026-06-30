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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useAccounts } from "@/hooks/use-accounts";
import { useSubmitPost } from "@/hooks/use-mutations";
import { getPlatformById } from "@/lib/config";
import { logClientError } from "@/lib/logger/client";
import { getMainFieldCharCounterState } from "@/lib/message-length-ui";
import { validatePostForResolvedAccounts } from "@/lib/validation/post-validation";
import type { ValidationResultByPlatform } from "@/lib/validation/post-validation";
import type { MediaFile, AccountOptionsMap, PostingMode, SocialPost, ThreadSegment } from "@/types";

import { AccountOptionsComponent } from "./account-options";
import { AccountSelector } from "./account-selector";
import { CreatePostForm } from "./create-post-form";
import { getClipboardImageFiles, MediaUpload, type MediaUploadHandle } from "./media-upload";
import { PostLinksModal } from "./post-links-modal";
import { PostPreview } from "./post-preview";

import type { ValidationIssue } from "@simple-post/sdk";

interface PostFormProps {
  mode: "create" | "edit";
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

  return <EditPostForm existingPost={existingPost} />;
}

function EditPostForm({ existingPost }: { existingPost: SocialPost }) {
  const mode = "edit";
  const router = useRouter();
  const [message, setMessage] = useState(existingPost.message || "");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(existingPost.accountIds || []);
  const [postingMode, setPostingMode] = useState<PostingMode>(existingPost.status === "draft" ? "draft" : "schedule");
  const [scheduledDate, setScheduledDate] = useState(
    existingPost.scheduledFor ? format(existingPost.scheduledFor, "yyyy-MM-dd") : "",
  );
  const [scheduledTime, setScheduledTime] = useState(
    existingPost.scheduledFor ? format(existingPost.scheduledFor, "HH:mm") : "",
  );
  const [media, setMedia] = useState<MediaFile[]>(existingPost.media || []);
  const [thread, setThread] = useState<ThreadSegment[]>(existingPost.thread || []);
  const [accountOptions, setAccountOptions] = useState<AccountOptionsMap>(existingPost.accountOptions || {});
  const [showPostLinksModal, setShowPostLinksModal] = useState(false);
  const [postingResults, setPostingResults] = useState<
    Array<{
      accountId: string;
      platform: string;
      success: boolean;
      error?: string;
      postUrl?: string;
    }>
  >([]);
  const [postingSucceeded, setPostingSucceeded] = useState(false);
  const [serverValidation, setServerValidation] = useState<ValidationResponse | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [accountOptionsBlocked, setAccountOptionsBlocked] = useState(false);
  const [tiktokConsent, setTikTokConsent] = useState(false);
  const mediaUploadRef = useRef<MediaUploadHandle | null>(null);
  const threadMediaUploadRefs = useRef<Array<MediaUploadHandle | null>>([]);

  const submitPostMutation = useSubmitPost();
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();

  const selectedAccounts = useMemo(
    () => accounts.filter((account) => selectedAccountIds.includes(account.id)),
    [accounts, selectedAccountIds],
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

  const localValidation = useMemo<ValidationResponse | null>(() => {
    if (selectedAccountIds.length === 0 || selectedAccounts.length !== selectedAccountIds.length) {
      return null;
    }

    return validatePostForResolvedAccounts({
      message,
      media,
      accounts: selectedAccounts,
      thread: thread.length > 0 ? thread : undefined,
    });
  }, [media, message, selectedAccountIds, selectedAccounts, thread]);

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
    [media, message, selectedAccountIds, thread],
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

    try {
      if (postingMode !== "draft") {
        const latestValidation = await runBackendValidation();
        if (!latestValidation?.summary.isValid) {
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
        media: MediaFile[];
        thread?: ThreadSegment[];
      } = {
        message: message.trim(),
        accountIds: selectedAccountIds,
        postingMode,
        media, // Already contains R2 URLs
      };

      // Only add schedule info if scheduling
      if (postingMode === "schedule") {
        const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
        body.scheduledFor = scheduledFor.toISOString();
      }

      if (Object.keys(accountOptions).length > 0) {
        body.accountOptions = accountOptions;
      }

      if (thread.length > 0) {
        body.thread = thread;
      }

      // Submit using mutation
      const data = await submitPostMutation.mutateAsync({
        body,
        mode,
        postId: existingPost.id,
      });

      // If posting now and we have posting results, show the modal
      if (postingMode === "now" && data.postingResults && Array.isArray(data.postingResults)) {
        setPostingResults(data.postingResults);

        // Check if all posts succeeded
        const allSucceeded = data.postingResults.every((r: { success: boolean }) => r.success);
        setPostingSucceeded(allSucceeded);

        setShowPostLinksModal(true);
        // Navigation will happen when modal closes (see onOpenChange below)
        // If failed, user can close modal and retry
      } else {
        // Scheduled or draft post - navigate to the updated post
        if (mode === "edit") {
          router.push(`/posts/${existingPost.id}`);
        } else if (postingMode === "draft") {
          router.push("/?tab=drafts");
        } else {
          router.push("/?tab=scheduled");
        }
      }
    } catch (error) {
      logClientError(error, `Failed to ${mode} post`, {
        postId: existingPost.id,
        postingMode,
        accountCount: selectedAccountIds.length,
      });
      toast.error(`Failed to ${mode} post. Please try again.`);
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
    (postingMode !== "schedule" || (scheduledDate && scheduledTime));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Message Input */}
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

        {/* Account Selection */}
        <AccountSelector
          selectedAccountIds={selectedAccountIds}
          onSelectionChange={setSelectedAccountIds}
          title="Accounts"
          description="Choose which accounts to publish your content to"
        />

        {/* Account-Specific Options */}
        <AccountOptionsComponent
          selectedAccountIds={selectedAccountIds}
          options={accountOptions}
          onOptionsChange={setAccountOptions}
          media={media}
          onBlockingChange={setAccountOptionsBlocked}
        />

        {/* Posting Mode Selection */}
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

        {/* Schedule Settings - Only show when scheduling */}
        {postingMode === "schedule" && (
          <div className="space-y-4">
            <div>
              <Label className="text-sm font-medium">Schedule</Label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="date" className="text-sm text-muted-foreground">
                  Date
                </Label>
                <Input
                  id="date"
                  type="date"
                  value={scheduledDate}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  min={format(new Date(), "yyyy-MM-dd")}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="time" className="text-sm text-muted-foreground">
                  Time
                </Label>
                <Input
                  id="time"
                  type="time"
                  value={scheduledTime}
                  onChange={(e) => setScheduledTime(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            {scheduledDate && scheduledTime && (
              <div className="p-3 rounded-lg border border-primary/30 bg-primary/5 text-sm text-muted-foreground">
                Publishing on{" "}
                <span className="font-medium text-foreground">
                  {format(new Date(`${scheduledDate}T${scheduledTime}`), "EEEE, MMMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
            )}
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
              if (mode === "edit") {
                router.push(`/posts/${existingPost.id}`);
              } else {
                router.push("/");
              }
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
                  : mode === "edit"
                    ? "Updating..."
                    : "Scheduling..."
              : postingMode === "draft"
                ? "Save Draft"
                : validationLoading
                  ? "Validating..."
                  : postingMode === "now"
                    ? "Post Now"
                    : mode === "edit"
                      ? "Update Post"
                      : "Schedule Post"}
          </Button>
        </div>
      </form>

      {/* Preview */}
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

      {/* Post Links Modal */}
      <PostLinksModal
        open={showPostLinksModal}
        onOpenChange={(open) => {
          setShowPostLinksModal(open);
          // Navigate when modal is closed
          if (!open && postingSucceeded) {
            // Navigate to Posted tab on success
            if (mode === "edit") {
              router.push(`/posts/${existingPost.id}`);
            } else {
              router.push("/?tab=past");
            }
          }
          // If posting failed, stay on the page to let user retry
        }}
        results={postingResults}
      />
    </div>
  );
}
