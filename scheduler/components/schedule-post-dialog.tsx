"use client";

import { useEffect, useMemo, useState } from "react";

import { format } from "date-fns";
import { toast } from "sonner";

import { TrialExpiryScheduleWarningNotice } from "@/components/billing/trial-post-allowance";
import { useSubmitPost } from "@/hooks/use-mutations";
import { scheduledTimeMessage } from "@/lib/i18n/scheduled-time-display";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { logClientError } from "@/lib/logger/client";
import { getLocalScheduledDateTimeError, parseLocalScheduledDateTime } from "@/lib/validations/scheduled-time";
import type { SocialPost } from "@/types";

import { SchedulePicker } from "./schedule-picker";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

interface SchedulePostDialogProps {
  post: SocialPost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScheduled?: () => void;
}

export function SchedulePostDialog({ post, open, onOpenChange, onScheduled }: SchedulePostDialogProps) {
  const { copy } = useUiCopy();
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const submitPostMutation = useSubmitPost();
  const isRescheduling = post.status === "scheduled";
  const scheduledForPreview = useMemo(
    () => (scheduledDate && scheduledTime ? parseLocalScheduledDateTime(scheduledDate, scheduledTime) : null),
    [scheduledDate, scheduledTime],
  );

  useEffect(() => {
    if (!open) return;

    setScheduledDate(post.scheduledFor ? format(post.scheduledFor, "yyyy-MM-dd") : "");
    setScheduledTime(post.scheduledFor ? format(post.scheduledFor, "HH:mm") : "");
  }, [open, post.scheduledFor]);

  const handleSchedule = async () => {
    const scheduleError = getLocalScheduledDateTimeError(scheduledDate, scheduledTime);
    if (scheduleError) {
      toast.error(scheduledTimeMessage(scheduleError, copy));
      return;
    }

    const scheduledFor = parseLocalScheduledDateTime(scheduledDate, scheduledTime);
    if (!scheduledFor) {
      toast.error(copy("Choose a valid date and time before scheduling this post."));
      return;
    }

    try {
      const result = await submitPostMutation.mutateAsync({
        mode: "edit",
        postId: post.id,
        body: {
          message: post.message,
          accountIds: post.accountIds,
          postingMode: "schedule",
          scheduledFor: scheduledFor.toISOString(),
          accountOptions: post.accountOptions,
          accountOverrides: post.accountOverrides,
          repost: {
            enabled: post.repostEnabled === true,
            delayHours: post.repostDelayHours ?? 12,
          },
          media: post.media,
          thread: post.thread,
          quotePostId: post.quotePostId ?? null,
        },
      });

      if (result.warnings?.length) {
        for (const warning of result.warnings) toast.warning(warning.message);
      } else {
        toast.success(isRescheduling ? copy("Post rescheduled.") : copy("Draft scheduled."));
      }
      onOpenChange(false);
      onScheduled?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : copy("Failed to schedule post.");
      logClientError(error, "Failed to schedule post", { postId: post.id });
      toast.error(message);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && submitPostMutation.isPending) return;
        onOpenChange(nextOpen);
      }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isRescheduling ? copy("Reschedule post") : copy("Schedule draft")}</DialogTitle>
          <DialogDescription>
            {isRescheduling
              ? copy("Choose a new date and time for this post.")
              : copy("Choose when this draft should be published.")}
          </DialogDescription>
        </DialogHeader>

        <SchedulePicker
          scheduledDate={scheduledDate}
          scheduledTime={scheduledTime}
          onScheduledDateChange={setScheduledDate}
          onScheduledTimeChange={setScheduledTime}
          excludePostId={post.id}
        />
        <TrialExpiryScheduleWarningNotice scheduledFor={scheduledForPreview} />

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitPostMutation.isPending}>
            {copy("Cancel")}{" "}
          </Button>
          <Button type="button" onClick={handleSchedule} disabled={submitPostMutation.isPending}>
            {submitPostMutation.isPending
              ? isRescheduling
                ? copy("Rescheduling...")
                : copy("Scheduling...")
              : isRescheduling
                ? copy("Reschedule")
                : copy("Schedule")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
