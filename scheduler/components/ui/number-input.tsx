"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/**
 * Integer input without the native number-spinner arrows. Only digits can be
 * typed (other characters are ignored), and the value is clamped into
 * [min, max] on blur. The parent always receives a number.
 *
 * Note: clamping happens on blur, not on every keystroke, so the parent's
 * onChange handler should store the raw value as-is rather than re-clamping it
 * (re-clamping mid-typing would fight the text the user is entering).
 */
export function NumberInput({
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  id,
  disabled,
  className,
  "aria-label": ariaLabel,
}: NumberInputProps) {
  const [text, setText] = useState(() => String(value));
  const [lastValue, setLastValue] = useState(value);

  // Re-sync the visible text when the parent value changes externally (initial
  // load, form reset) — but not when it merely echoes what's already typed.
  if (value !== lastValue) {
    setLastValue(value);
    if (Number.parseInt(text, 10) !== value) {
      setText(String(value));
    }
  }

  const handleBlur = () => {
    const parsed = Number.parseInt(text, 10);
    const next = Number.isNaN(parsed) ? value : Math.min(max, Math.max(min, parsed));
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      disabled={disabled}
      value={text}
      onChange={(event) => {
        const digits = event.target.value.replaceAll(/\D/g, "");
        setText(digits);
        if (digits !== "") onChange(Number.parseInt(digits, 10));
      }}
      onBlur={handleBlur}
      className={cn("text-center text-sm", className)}
    />
  );
}
