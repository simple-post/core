"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

interface TextareaProps extends React.ComponentProps<"textarea"> {
  autoResize?: boolean;
  maxAutoHeight?: number;
}

function setRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

function resizeTextarea(textarea: HTMLTextAreaElement, maxHeight: number) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ autoResize = true, className, maxAutoHeight = 320, onChange, style, value, defaultValue, ...props }, ref) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

    const updateSize = React.useCallback(() => {
      if (autoResize && textareaRef.current) {
        resizeTextarea(textareaRef.current, maxAutoHeight);
      }
    }, [autoResize, maxAutoHeight]);

    React.useEffect(() => {
      updateSize();
    }, [defaultValue, updateSize, value]);

    const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event);
      if (autoResize) {
        resizeTextarea(event.currentTarget, maxAutoHeight);
      }
    };

    const handleRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        setRef(ref, node);
      },
      [ref],
    );

    return (
      <textarea
        data-slot="textarea"
        ref={handleRef}
        className={cn(
          "border-border placeholder:text-muted-foreground bg-input flex field-sizing-content min-h-16 w-full rounded-lg border px-3 py-2 text-sm transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50",
          "focus-visible:border-primary/40 focus-visible:ring-primary/30 focus-visible:ring-[3px]",
          "aria-invalid:ring-destructive/30 aria-invalid:border-destructive",
          autoResize && "overflow-y-hidden",
          className,
        )}
        onChange={handleChange}
        style={{
          maxHeight: autoResize ? maxAutoHeight : undefined,
          ...style,
        }}
        value={value}
        defaultValue={defaultValue}
        {...props}
      />
    );
  },
);

Textarea.displayName = "Textarea";

export { Textarea };
