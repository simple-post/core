"use client";
import type { ComponentProps, ReactNode } from "react";

import { useUiTranslation } from "@/lib/i18n/client";

import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

/** The composer field has no upload, API, account or navigation dependency. */
export function MessageComposer({
  id,
  label,
  message,
  onMessageChange,
  media,
  counter,
  ...textareaProps
}: {
  id: string;
  label?: string;
  message: string;
  onMessageChange: (value: string) => void;
  media?: ReactNode;
  counter?: ReactNode;
} & Omit<ComponentProps<typeof Textarea>, "id" | "value" | "onChange">) {
  const { locale, t } = useUiTranslation();
  return (
    <div className="simplepost-visual">
      <Label htmlFor={id} className="text-sm font-medium">
        {label ?? t("message")}
      </Label>
      <Textarea
        id={id}
        placeholder={t("composerPlaceholder")}
        dir="auto"
        {...textareaProps}
        value={message}
        onChange={(event) => onMessageChange(event.target.value)}
        className="min-h-32 resize-none mt-2"
      />
      {media ? <div className="mt-1">{media}</div> : null}
      <div className="mt-2 flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 text-xs">
        {counter ?? <span className="text-muted-foreground">{message.length.toLocaleString(locale)}</span>}
      </div>
    </div>
  );
}
