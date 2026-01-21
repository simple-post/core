"use client";

import type React from "react";
import { useState } from "react";

import { useRouter } from "next/navigation";

import { format } from "date-fns";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { useSubmitPost } from "@/hooks/use-mutations";
import type { MediaFile, AccountOptionsMap, SocialPost } from "@/types";

import { AccountOptionsComponent } from "./account-options";
import { AccountSelector } from "./account-selector";
import { MediaUpload } from "./media-upload";
import { PostLinksModal } from "./post-links-modal";
import { PostPreview } from "./post-preview";

interface PostFormProps {
  mode: "create" | "edit";
  existingPost?: SocialPost;
}

export function PostForm({ mode, existingPost }: PostFormProps) {
  const router = useRouter();
  const [message, setMessage] = useState(existingPost?.message || "");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>(existingPost?.accountIds || []);
  const [postingMode, setPostingMode] = useState<"now" | "schedule">(
    existingPost?.status === "scheduled" ? "schedule" : "now",
  );
  const [scheduledDate, setScheduledDate] = useState(
    existingPost?.scheduledFor ? format(existingPost.scheduledFor, "yyyy-MM-dd") : "",
  );
  const [scheduledTime, setScheduledTime] = useState(
    existingPost?.scheduledFor ? format(existingPost.scheduledFor, "HH:mm") : "",
  );
  const [media, setMedia] = useState<MediaFile[]>(existingPost?.media || []);
  const [accountOptions, setAccountOptions] = useState<AccountOptionsMap>(existingPost?.accountOptions || {});
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

  const submitPostMutation = useSubmitPost();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate based on posting mode
    if (!message.trim() || selectedAccountIds.length === 0) {
      return;
    }

    if (postingMode === "schedule" && (!scheduledDate || !scheduledTime)) {
      return;
    }

    try {
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
        postId: existingPost?.id,
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
          router.push(`/posts/${existingPost?.id}`);
        } else {
          router.push("/?tab=scheduled");
        }
      }
    } catch (error) {
      console.error(`Failed to ${mode} post:`, error);
      alert(`Failed to ${mode} post. Please try again.`);
    }
  };

  const isFormValid =
    message.trim() && selectedAccountIds.length > 0 && (postingMode === "now" || (scheduledDate && scheduledTime));

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
              maxLength={2000}
            />
            <div className="flex justify-between items-center mt-2">
              <p className="text-xs text-muted-foreground">Share your thoughts, updates, or announcements</p>
              <p className="text-xs text-muted-foreground">{message.length}/2000</p>
            </div>
          </div>

          {/* Media Upload */}
          <div>
            <Label className="text-sm font-medium">Media</Label>
            <div className="mt-2">
              <MediaUpload media={media} onMediaChange={setMedia} />
            </div>
          </div>
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
                router.push(`/posts/${existingPost?.id}`);
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
          if (!open) {
            if (postingSucceeded) {
              // Navigate to Posted tab on success
              if (mode === "edit") {
                router.push(`/posts/${existingPost?.id}`);
              } else {
                router.push("/?tab=past");
              }
            }
            // If posting failed, stay on the page to let user retry
          }
        }}
        results={postingResults}
      />
    </div>
  );
}
