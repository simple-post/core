"use client";

import { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";

import { UiCopy } from "@/components/ui-copy";
import { useWorkspaceReadOnly } from "@/hooks/use-billing";
import { scheduledTimeMessage } from "@/lib/i18n/scheduled-time-display";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import { getTikTokPostRecovery, tomorrowRetryTime } from "@/lib/posting/tiktok-recovery";
import { parseLocalScheduledDateTime, getLocalScheduledDateTimeError } from "@/lib/validations/scheduled-time";
import type { SocialPost } from "@/types";

import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";

export function retryScheduleTimes(start: Date, count: number, spacingHours: number) {
  return Array.from({ length: count }, (_, index) => {
    const time = new Date(start);
    if (spacingHours === 24) time.setDate(time.getDate() + index);
    else time.setTime(time.getTime() + index * spacingHours * 3_600_000);
    return time;
  });
}

export function TikTokRecoveryNotice({ posts }: { posts: SocialPost[] }) {
  const { copy, locale } = useUiCopy();
  const readOnly = useWorkspaceReadOnly();
  const eligible = posts.filter((post) => getTikTokPostRecovery(post, copy));
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [spacing, setSpacing] = useState(24);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  if (readOnly || eligible.length === 0) return null;
  const recovery = getTikTokPostRecovery(eligible[0], copy)!;
  const automatic = eligible.length === 1 && eligible[0].status === "scheduled" && recovery.automaticRetry;
  const showDialog = (tomorrow: boolean) => {
    setDate(tomorrow ? format(tomorrowRetryTime(), "yyyy-MM-dd") : "");
    setTime("09:00");
    setOpen(true);
  };
  const start = parseLocalScheduledDateTime(date, time);
  const dates = start ? retryScheduleTimes(start, eligible.length, spacing) : [];

  const save = async () => {
    const error = getLocalScheduledDateTimeError(date, time);
    if (error) {
      toast.error(scheduledTimeMessage(error, copy));
      return;
    }
    setSaving(true);
    let completed = 0;
    const errors: string[] = [];
    for (const [index, post] of eligible.entries()) {
      try {
        const response = await fetch(`/api/v1/posts/${post.id}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduledFor: dates[index].toISOString(),
            expectedUpdatedAt: post.updatedAt?.toISOString(),
          }),
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? body.error ?? body.message ?? copy("Could not schedule retry."));
        completed += 1;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : copy("Could not schedule retry."));
      }
    }
    await queryClient.invalidateQueries({ queryKey: ["posts"] });
    setSaving(false);
    setOpen(false);
    if (completed)
      toast.success(
        copy("{{count, number}} retries scheduled. TikTok acceptance is not guaranteed.", { count: completed }),
      );
    if (errors.length > 0)
      toast.error(
        copy("{{count, number}} posts were not rescheduled: {{reason}}", { count: errors.length, reason: errors[0] }),
      );
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-secondary/40 p-4 space-y-3" role="status">
        <p className="text-sm font-medium">
          {eligible.length > 1
            ? copy("{{count, number}} posts can be scheduled for another TikTok attempt", { count: eligible.length })
            : recovery.title}
        </p>
        <p className="text-sm text-muted-foreground">{recovery.message}</p>
        {eligible.length === 1 &&
          eligible[0].status === "scheduled" &&
          eligible[0].scheduledFor &&
          eligible[0].scheduledFor > new Date() && (
            <p className="text-sm">
              {copy("Next attempt: {{date}} ({{timezone}}).", {
                date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
                  eligible[0].scheduledFor,
                ),
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              })}
            </p>
          )}
        {!automatic && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => showDialog(true)}>
              {eligible.length > 1 ? copy("Spread retries over days") : copy("Retry tomorrow")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => showDialog(false)}>
              {copy("Choose a time")}{" "}
            </Button>
          </div>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {eligible.length > 1 ? copy("Schedule TikTok retries") : copy("Schedule another TikTok attempt")}
            </DialogTitle>
            <DialogDescription>
              {copy(
                "Your existing posts and their content will be kept. Accounts that already succeeded will be skipped. TikTok may still reject the next attempt.",
              )}{" "}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm space-y-2">
              <UiCopy
                source="First retry date <part1></part1>"
                components={{
                  part1: (
                    <Input
                      aria-label={copy("First retry date")}
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  ),
                }}
              />
            </label>
            <label className="text-sm space-y-2">
              <UiCopy
                source="Local time <part1></part1>"
                components={{
                  part1: (
                    <Input
                      aria-label={copy("Local time")}
                      type="time"
                      value={time}
                      onChange={(event) => setTime(event.target.value)}
                    />
                  ),
                }}
              />
            </label>
          </div>
          {eligible.length > 1 && (
            <label className="text-sm space-y-2">
              {copy("Space retries")}{" "}
              <select
                className="w-full rounded-md border bg-background p-2"
                value={spacing}
                onChange={(event) => setSpacing(Number(event.target.value))}>
                <option value={24}>{copy("One per day")}</option>
                <option value={1}>{copy("One per hour")}</option>
                <option value={0.333_333_333_333_333_3}>{copy("Every 20 minutes")}</option>
              </select>
            </label>
          )}
          <p className="text-sm text-muted-foreground">
            <UiCopy
              source="Times use <part1></part1>. In inbox mode, this schedules an upload; you still finish publishing in TikTok. Spacing retries does not remove TikTok's limits."
              components={{ part1: <>{Intl.DateTimeFormat().resolvedOptions().timeZone}</> }}
            />
          </p>
          <ol className="max-h-48 overflow-auto text-sm space-y-2" aria-label={copy("Retry schedule preview")}>
            {dates.map((value, index) => (
              <li key={eligible[index].id}>
                {new Intl.NumberFormat(locale).format(index + 1)}.{" "}
                {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(value)} —{" "}
                {eligible[index].message.slice(0, 70) || copy("Untitled post")}
              </li>
            ))}
          </ol>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              {copy("Cancel")}{" "}
            </Button>
            <Button onClick={() => void save()} disabled={saving || dates.length === 0}>
              {saving
                ? copy("Scheduling...")
                : eligible.length > 1
                  ? copy("Schedule {{count, number}} retries", { count: eligible.length })
                  : copy("Schedule retry")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
