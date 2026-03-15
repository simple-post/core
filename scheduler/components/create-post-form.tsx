"use client";

import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useRouter } from "next/navigation";

import { format } from "date-fns";
import { AlertCircle, Info } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useSubmitPost } from "@/hooks/use-mutations";
import { getAccountDisplayName, getPlatformById } from "@/lib/config";
import type { AccountOptionsMap, AccountOverridesMap, ConnectedAccount } from "@/types";

import { AccountSelector } from "./account-selector";
import { GenericPostPreview } from "./generic-post-preview";
import { MediaUpload } from "./media-upload";
import { usePostDraft } from "./post-draft-context";
import { PostLinksModal } from "./post-links-modal";

import type { PlatformValidationRules, ValidationIssue } from "@simple-post/sdk";

interface ValidationResponse {
  platforms: string[];
  results: Array<{
    accountId: string;
    platform: string;
    rules: PlatformValidationRules;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    isValid: boolean;
    usesCommonContent: boolean;
  }>;
  summary: {
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    isValid: boolean;
  };
  accounts: ConnectedAccount[];
}

export function CreatePostForm() {
  const router = useRouter();
  const submitPostMutation = useSubmitPost();

  const {
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
  } = usePostDraft();

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
            accountOverrides: enabledOverrides,
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
    [enabledOverrides, media, message, selectedAccountIds],
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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

      const body: {
        message: string;
        accountIds: string[];
        postingMode: "now" | "schedule";
        scheduledFor?: string;
        accountOptions?: AccountOptionsMap;
        accountOverrides?: AccountOverridesMap;
        media: typeof media;
      } = {
        message: message.trim(),
        accountIds: selectedAccountIds,
        postingMode,
        media,
      };

      if (postingMode === "schedule") {
        const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);
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

      const data = await submitPostMutation.mutateAsync({
        body,
        mode: "create",
      });

      if (postingMode === "now" && data.postingResults && Array.isArray(data.postingResults)) {
        setPostingResults(data.postingResults);

        const allSucceeded = data.postingResults.every((r: { success: boolean }) => r.success);
        setPostingSucceeded(allSucceeded);

        setShowPostLinksModal(true);
      } else {
        router.push("/?tab=scheduled");
      }
    } catch (error) {
      console.error("Failed to create post:", error);
      alert("Failed to create post. Please try again.");
    }
  };

  const isFormValid =
    selectedAccountIds.length > 0 &&
    (validation?.summary.isValid ?? false) &&
    !validationLoading &&
    (postingMode === "now" || (scheduledDate && scheduledTime));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        <AccountSelector
          selectedAccountIds={selectedAccountIds}
          onSelectionChange={setSelectedAccountIds}
          title="Post to"
          showAdvancedButton
          getAdvancedHref={(accountId) => `/schedule/advanced/${accountId}`}
          layout="row"
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

          <div>
            <Label className="text-sm font-medium">Media</Label>
            <div className="mt-2">
              <MediaUpload media={media} onMediaChange={setMedia} />
            </div>
          </div>

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
                : "Scheduling..."
              : validationLoading
                ? "Validating..."
                : postingMode === "now"
                  ? "Post Now"
                  : "Schedule Post"}
          </Button>
        </div>
      </form>

      <div className="lg:sticky lg:top-8 self-start">
        <GenericPostPreview message={message} media={media} />
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
