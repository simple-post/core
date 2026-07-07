"use client";

import { CalendarClock, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { WEEKDAYS, type PostingSlotConfig } from "@/lib/posting-slots/occurrences";
import { cn } from "@/lib/utils";

// Suggested times for newly added rows, first unused one wins.
const SUGGESTED_TIMES = ["17:00", "09:00", "12:00", "15:00", "19:00", "21:00"];
const DEFAULT_NEW_SLOT_WEEKDAYS = [1, 2, 3, 4, 5]; // Mon-Fri

// A slot row being edited. The clientId only gives rows a stable identity in
// the table (React keys, no jumping while editing); it is stripped before
// saving and re-generated when the saved list loads.
export interface PostingSlotRow extends PostingSlotConfig {
  clientId: string;
}

function createClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slot-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createSlotRows(slots: PostingSlotConfig[]): PostingSlotRow[] {
  return slots.map((slot) => ({ ...slot, clientId: createClientId() }));
}

function suggestNewSlotTime(slots: PostingSlotRow[]): string {
  const used = new Set(slots.map((slot) => slot.time));
  return SUGGESTED_TIMES.find((time) => !used.has(time)) ?? "17:00";
}

export function PostingSlotsSection({
  slots,
  onChange,
  disabled,
}: {
  slots: PostingSlotRow[];
  onChange: (slots: PostingSlotRow[]) => void;
  disabled: boolean;
}) {
  const activeSlotCount = slots.reduce((count, slot) => count + slot.weekdays.length, 0);

  const updateSlot = (clientId: string, updates: Partial<PostingSlotConfig>) => {
    onChange(slots.map((slot) => (slot.clientId === clientId ? { ...slot, ...updates } : slot)));
  };

  const toggleWeekday = (clientId: string, day: number, checked: boolean) => {
    const slot = slots.find((candidate) => candidate.clientId === clientId);
    if (!slot) return;

    const weekdays = checked ? [...slot.weekdays, day] : slot.weekdays.filter((d) => d !== day);
    updateSlot(clientId, { weekdays: [...new Set(weekdays)].sort((a, b) => a - b) });
  };

  const addSlot = () => {
    onChange([
      ...slots,
      { clientId: createClientId(), time: suggestNewSlotTime(slots), weekdays: DEFAULT_NEW_SLOT_WEEKDAYS },
    ]);
  };

  const removeSlot = (clientId: string) => {
    onChange(slots.filter((slot) => slot.clientId !== clientId));
  };

  return (
    <section className="rounded-xl border border-border bg-card p-4 animate-reveal animate-reveal-delay-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Posting slots</h2>
        </div>
        {activeSlotCount > 0 ? <span className="text-xs text-muted-foreground">{activeSlotCount} per week</span> : null}
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        Plan your week with default posting times. Check the days each time applies — new posts can then be scheduled
        into the next free slot with one click.
      </p>

      {slots.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[28rem] border-separate border-spacing-y-1">
            <thead>
              <tr>
                <th className="w-32 pb-1 text-left text-xs font-medium text-muted-foreground">Time</th>
                {WEEKDAYS.map(({ day, label }) => (
                  <th key={day} className="pb-1 text-center text-xs font-medium text-muted-foreground">
                    {label}
                  </th>
                ))}
                <th className="w-9" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {slots.map((slot, index) => (
                <tr key={slot.clientId} className={cn(slot.weekdays.length === 0 && "opacity-60")}>
                  <td className="pr-2">
                    <input
                      type="time"
                      aria-label={`Slot ${index + 1} time`}
                      value={slot.time}
                      disabled={disabled}
                      onChange={(event) => {
                        if (event.target.value) updateSlot(slot.clientId, { time: event.target.value });
                      }}
                      className="h-8 w-28 rounded-md border border-border bg-input/60 px-2 text-sm font-medium tabular-nums text-foreground outline-none transition-colors focus:border-primary/40 focus:ring-[3px] focus:ring-primary/20 disabled:opacity-50 [color-scheme:dark] [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                  </td>
                  {WEEKDAYS.map(({ day, label }) => (
                    <td key={day} className="text-center">
                      <Checkbox
                        aria-label={`${label} at ${slot.time}`}
                        checked={slot.weekdays.includes(day)}
                        disabled={disabled}
                        onCheckedChange={(checked) => toggleWeekday(slot.clientId, day, checked === true)}
                      />
                    </td>
                  ))}
                  <td className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${slot.time} slot`}
                      disabled={disabled}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeSlot(slot.clientId)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          No posting slots yet. Add a time to start planning your week.
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        className="mt-3 gap-2 text-muted-foreground"
        onClick={addSlot}>
        <Plus className="h-3.5 w-3.5" />
        Add time slot
      </Button>
    </section>
  );
}
