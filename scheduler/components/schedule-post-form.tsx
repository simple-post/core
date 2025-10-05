"use client";

import type React from "react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { createPostsRepository } from "@/lib/config";
import type { MediaFile, PlatformOptions } from "@/lib/types";
import { format } from "date-fns";
import { MediaUpload } from "./media-upload";
import { PlatformSelector } from "./platform-selector";
import { PlatformOptionsComponent } from "./platform-options";

export function SchedulePostForm() {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [platformOptions, setPlatformOptions] = useState<PlatformOptions>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || selectedPlatforms.length === 0 || !scheduledDate || !scheduledTime) {
      return;
    }

    setIsSubmitting(true);
    try {
      const repository = createPostsRepository();
      const scheduledFor = new Date(`${scheduledDate}T${scheduledTime}`);

      await repository.createPost({
        message: message.trim(),
        platforms: selectedPlatforms,
        media,
        scheduledFor,
        status: "scheduled",
        platformOptions,
      });

      router.push("/");
    } catch (error) {
      console.error("Failed to create post:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isFormValid = message.trim() && selectedPlatforms.length > 0 && scheduledDate && scheduledTime;

  return (
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

      {/* Platform Selection */}
      <PlatformSelector
        selectedPlatforms={selectedPlatforms}
        onSelectionChange={setSelectedPlatforms}
        title="Platforms"
        description="Choose where to publish your content"
      />

      {/* Platform-Specific Options */}
      <PlatformOptionsComponent
        selectedPlatforms={selectedPlatforms}
        options={platformOptions}
        onOptionsChange={setPlatformOptions}
      />

      {/* Schedule Settings */}
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

      {/* Submit Button */}
      <div className="flex gap-4 pt-4">
        <Button type="button" variant="outline" onClick={() => router.push("/")} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={!isFormValid || isSubmitting} className="flex-1">
          {isSubmitting ? "Scheduling..." : "Schedule Post"}
        </Button>
      </div>
    </form>
  );
}
