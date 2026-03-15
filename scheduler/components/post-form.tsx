"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { format } from "date-fns";
import { AlertCircle, Info } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useSubmitPost } from "@/hooks/use-mutations";
import { getPlatformById } from "@/lib/config";
import type { MediaFile, AccountOptionsMap, SocialPost } from "@/types";

import { AccountOptionsComponent } from "./account-options";
import { AccountSelector } from "./account-selector";
import { CreatePostForm } from "./create-post-form";
import { MediaUpload } from "./media-upload";
import { PostLinksModal } from "./post-links-modal";
import { PostPreview } from "./post-preview";

import type { PlatformValidationRules, ValidationIssue } from "@simple-post/sdk";

interface PostFormProps {
  mode: "create" | "edit";
  existingPost?: SocialPost;
}

interface ValidationResponse {
  platforms: string[];
  results: Array<{
    platform: string;
    rules: PlatformValidationRules;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    isValid: boolean;
  }>;
  summary: {
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    isValid: boolean;
  };
}

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
  const [postingMode, setPostingMode] = useState<"now" | "schedule">(
    existingPost.status === "scheduled" ? "schedule" : "now",
  );
  const [scheduledDate, setScheduledDate] = useState(
    existingPost.scheduledFor ? format(existingPost.scheduledFor, "yyyy-MM-dd") : "",
  );
  const [scheduledTime, setScheduledTime] = useState(
    existingPost.scheduledFor ? format(existingPost.scheduledFor, "HH:mm") : "",
  );
  const [media, setMedia] = useState<MediaFile[]>(existingPost.media || []);
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
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const submitPostMutation = useSubmitPost();

  const runValidation = useCallback(
    async (signal?: AbortSignal): Promise<ValidationResponse | null> => {
      if (selectedAccountIds.length === 0) {
        setValidation(null);
        setValidationError(null);
        return null;
      }

      setValidationLoading(true);
      try {
        const response = await fetch("/api/validation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            media,
            accountIds: selectedAccountIds,
          }),
          signal,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Validation failed");
        }

        const data = (await response.json()) as ValidationResponse;
        setValidation(data);
        setValidationError(null);
        return data;
      } catch (error) {
        if (signal?.aborted) {
          return null;
        }
        setValidationError(error instanceof Error ? error.message : "Validation failed");
        setValidation(null);
        return null;
      } finally {
        setValidationLoading(false);
      }
    },
    [media, message, selectedAccountIds],
  );

  useEffect(() => {
    if (selectedAccountIds.length === 0) {
      setValidation(null);
      setValidationError(null);
      setValidationLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      void runValidation(controller.signal);
    }, 250);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [runValidation, selectedAccountIds]);

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

  const formattedIssue = (issue: ValidationIssue) => {
    const platform = getPlatformById(issue.platform)?.name || issue.platform.toUpperCase();
    return `${platform}: ${issue.message}`;
  };

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
      const latestValidation = await runValidation();
      if (!latestValidation?.summary.isValid) {
        return;
      }

      // Build the request body - media is already uploaded to R2
      const body: {
        message: string;
        accountIds: string[];
        postingMode: "now" | "schedule";
        scheduledFor?: string;
        accountOptions?: AccountOptionsMap;
        media: MediaFile[];
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
        // Scheduled post - navigate to Scheduled tab
        if (mode === "edit") {
          router.push(`/posts/${existingPost.id}`);
        } else {
          router.push("/?tab=scheduled");
        }
      }
    } catch (error) {
      console.error(`Failed to ${mode} post:`, error);
      toast.error(`Failed to ${mode} post. Please try again.`);
    }
  };

  const isFormValid =
    selectedAccountIds.length > 0 &&
    (validation?.summary.isValid ?? false) &&
    !validationLoading &&
    (postingMode === "now" || (scheduledDate && scheduledTime));

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
              className="min-h-32 resize-none mt-2 border-border/50"
              maxLength={maxTextLength}
            />
            <div className="flex justify-between items-center mt-2">
              <p className="text-xs text-muted-foreground">Share your thoughts, updates, or announcements</p>
              <p className="text-xs text-muted-foreground">
                {message.length}
                {maxTextLength ? `/${maxTextLength}` : ""}
              </p>
            </div>
          </div>

          {/* Media Upload */}
          <div>
            <Label className="text-sm font-medium">Media</Label>
            <div className="mt-2">
              <MediaUpload media={media} onMediaChange={setMedia} />
            </div>
          </div>

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
        />

        {/* Posting Mode Selection */}
        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">When to Post</Label>
          </div>
          <RadioGroup value={postingMode} onValueChange={(value) => setPostingMode(value as "now" | "schedule")}>
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
                  className="mt-1 border-border/50"
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
                  className="mt-1 border-border/50"
                />
              </div>
            </div>

            {scheduledDate && scheduledTime && (
              <div className="p-3 bg-muted/50 rounded text-sm text-muted-foreground">
                Publishing on{" "}
                <span className="font-medium text-foreground">
                  {format(new Date(`${scheduledDate}T${scheduledTime}`), "EEEE, MMMM d, yyyy 'at' h:mm a")}
                </span>
              </div>
            )}
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
                : mode === "edit"
                  ? "Updating..."
                  : "Scheduling..."
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
      <div className="lg:sticky lg:top-8 self-start">
        <PostPreview
          message={message}
          media={media}
          scheduledDate={scheduledDate}
          scheduledTime={scheduledTime}
          selectedPlatforms={selectedAccountIds}
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
