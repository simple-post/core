"use client";

import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import { Repeat2 } from "lucide-react";
import { toast } from "sonner";

import { Navbar } from "@/components/navbar";
import { createSlotRows, PostingSlotsSection, type PostingSlotRow } from "@/components/posting-slots-settings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { Switch } from "@/components/ui/switch";
import { usePostingSlots, useUpdatePostingSlots } from "@/hooks/use-posting-slots";
import { useRepostSettings, useUpdateRepostSettings } from "@/hooks/use-repost-settings";
import { logClientError } from "@/lib/logger/client";

const MIN_DELAY_HOURS = 1;
const MAX_DELAY_HOURS = 720;

function clampDelayHours(value: number) {
  if (!Number.isFinite(value)) return 12;
  return Math.min(MAX_DELAY_HOURS, Math.max(MIN_DELAY_HOURS, Math.round(value)));
}

function RepostDefaultsSection({
  enabled,
  setEnabled,
  delayHours,
  setDelayHours,
  disabled,
}: {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
  delayHours: number;
  setDelayHours: Dispatch<SetStateAction<number>>;
  disabled: boolean;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 animate-reveal animate-reveal-delay-1">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Repeat2 className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Automatic reposts</h2>
        </div>
        <Switch id="auto-repost-enabled" checked={enabled} disabled={disabled} onCheckedChange={setEnabled} />
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        Default for new posts. Applies to X, Bluesky, Threads, and LinkedIn.
      </p>

      {enabled ? (
        <div className="mt-3 flex items-center gap-2">
          <Label htmlFor="repost-delay-hours" className="text-sm font-medium">
            Repost after
          </Label>
          <NumberInput
            id="repost-delay-hours"
            min={MIN_DELAY_HOURS}
            max={MAX_DELAY_HOURS}
            value={delayHours}
            disabled={disabled}
            onChange={setDelayHours}
            className="h-8 w-16 px-2"
          />
          <span className="text-sm text-muted-foreground">hours</span>
        </div>
      ) : null}
    </section>
  );
}

export default function SettingsPage() {
  const { data: settings, isLoading } = useRepostSettings();
  const updateSettings = useUpdateRepostSettings();
  const { data: savedSlots, isLoading: slotsLoading } = usePostingSlots();
  const updateSlots = useUpdatePostingSlots();
  const [enabled, setEnabled] = useState(false);
  const [delayHours, setDelayHours] = useState(12);
  const [slots, setSlots] = useState<PostingSlotRow[]>([]);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setDelayHours(settings.delayHours);
  }, [settings]);

  useEffect(() => {
    if (!savedSlots) return;
    setSlots(createSlotRows(savedSlots));
  }, [savedSlots]);

  const disabled = isLoading || slotsLoading || updateSettings.isPending || updateSlots.isPending;
  const saving = updateSettings.isPending || updateSlots.isPending;

  const handleSave = async () => {
    try {
      const [saved, savedSlotList] = await Promise.all([
        updateSettings.mutateAsync({
          enabled,
          delayHours: clampDelayHours(delayHours),
        }),
        // Rows the user never gave a time can't be saved; drop them silently.
        updateSlots.mutateAsync(
          slots.filter((slot) => slot.time.length > 0).map(({ time, weekdays }) => ({ time, weekdays })),
        ),
      ]);
      setEnabled(saved.enabled);
      setDelayHours(saved.delayHours);
      setSlots(createSlotRows(savedSlotList));
      toast.success("Settings saved");
    } catch (error) {
      logClientError(error, "Failed to save settings");
      toast.error("Failed to save settings.");
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      <main className="max-w-3xl mx-auto px-[clamp(18px,4vw,48px)] py-6 space-y-5">
        <div className="animate-reveal">
          <div className="flex items-center gap-3">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Account</span>
            </div>
            <span className="h-3 w-px bg-border" />
            <h1 className="text-xl font-semibold tracking-[-0.025em] text-foreground">
              <span className="text-primary">Settings</span>
            </h1>
          </div>
        </div>

        <RepostDefaultsSection
          enabled={enabled}
          setEnabled={setEnabled}
          delayHours={delayHours}
          setDelayHours={setDelayHours}
          disabled={disabled}
        />

        <PostingSlotsSection slots={slots} onChange={setSlots} disabled={disabled} />

        <div className="flex justify-center">
          <Button onClick={handleSave} disabled={disabled}>
            {saving ? "Saving..." : "Save settings"}
          </Button>
        </div>
      </main>
    </div>
  );
}
