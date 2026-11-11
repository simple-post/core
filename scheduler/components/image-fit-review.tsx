"use client";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { UiCopy } from "@/components/ui-copy";
import type { SourceCopy } from "@/lib/i18n/source-copy";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";
import type { MediaFile } from "@/types";

import type { ImageFit, ImageFitContent, ValidationIssue } from "@simple-post/sdk";

type ImageSlot = { key: string; label: string; url: string; replace: (url: string, file?: MediaFile) => void };

/** Locations include account overrides, thread images and video covers. */
function imageSlots(content: ImageFitContent, copy: SourceCopy): ImageSlot[] {
  const slots: ImageSlot[] = [];
  const add = (media: MediaFile[] | undefined, prefix: string, label = prefix) => {
    for (const [index, item] of (media ?? []).entries()) {
      if (item.type === "image")
        slots.push({
          key: `${prefix}.${index}`,
          label: copy("{{location}} · image {{index, number}}", { location: label, index: index + 1 }),
          url: item.url,
          replace: (url, file) => Object.assign(item, file ?? { url }),
        });
      else if (item.thumbnailUrl)
        slots.push({
          key: `${prefix}.${index}.cover`,
          label: copy("{{location}} · video cover", { location: label }),
          url: item.thumbnailUrl,
          replace: (url) => {
            item.thumbnailUrl = url;
          },
        });
    }
  };
  add(content.media, "Shared post", copy("Shared post"));
  for (const [index, segment] of (content.thread ?? []).entries())
    add(segment.media, `Thread ${index + 1}`, copy("Thread {{index, number}}", { index: index + 1 }));
  for (const [id, override] of Object.entries(content.accountOverrides ?? {})) {
    add(override.media, id);
    for (const [index, segment] of (override.thread ?? []).entries())
      add(
        segment.media,
        `${id} · thread ${index + 1}`,
        copy("{{account}} · thread {{index, number}}", { account: id, index: index + 1 }),
      );
  }
  for (const [id, options] of Object.entries(content.accountOptions ?? {})) {
    if (typeof options?.thumbnailUrl === "string")
      slots.push({
        key: `${id}.cover`,
        label: copy("{{account}} · custom thumbnail", { account: id }),
        url: options.thumbnailUrl,
        replace: (url) => {
          options.thumbnailUrl = url;
        },
      });
  }
  return slots;
}

export function ImageFitReview({
  content,
  accountIds,
  message,
  onApply,
  onClose,
}: {
  content: ImageFitContent;
  accountIds: string[];
  message: string;
  onApply: (content: ImageFitContent) => void;
  onClose: () => void;
}) {
  const { copy } = useUiCopy();
  // Every algorithm change starts from the source, never an already-cropped derivative.
  const [source, setSource] = useState(() => structuredClone(content));
  const [mode, setMode] = useState<ImageFit>("blur");
  const [prepared, setPrepared] = useState<ImageFitContent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<ValidationIssue[]>([]);

  async function generate() {
    setBusy(true);
    setError(null);
    setPrepared(null);
    try {
      const response = await fetch("/api/v1/validation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...source, accountIds, message, imageFit: mode }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || copy("Could not fit these images."));
      if (!data.fittedContent) throw new Error(copy("No fitted images were returned. Please try again."));
      setPrepared(data.fittedContent);
      setRemaining(data.summary.errors);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : copy("Could not fit images."));
    } finally {
      setBusy(false);
    }
  }

  async function replace(key: string, file: File) {
    setBusy(true);
    setError(null);
    setPrepared(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/v1/upload", { method: "POST", body: form });
      const uploaded = await response.json();
      if (!response.ok) throw new Error(uploaded.error || copy("Could not upload replacement image."));
      const next = structuredClone(source);
      imageSlots(next, copy)
        .find((slot) => slot.key === key)
        ?.replace(uploaded.url, { ...uploaded, id: crypto.randomUUID(), type: "image", filename: file.name });
      setSource(next);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : copy("Could not replace image."));
    } finally {
      setBusy(false);
    }
  }

  const previews = prepared ? imageSlots(prepared, copy) : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy("Fit images for your platforms")}</DialogTitle>
          <DialogDescription>
            {copy(
              "Review the result before using it. Originals stay unchanged. Images are converted to JPEG when needed; animations that need fitting become still images.",
            )}{" "}
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="flex flex-wrap gap-4">
          <legend className="sr-only">{copy("Fitting method")}</legend>
          <label className="flex items-center gap-2">
            <UiCopy
              source="<part1></part1>Blurred background · keep full image"
              components={{
                part1: (
                  <input
                    type="radio"
                    name="image-fit"
                    checked={mode === "blur"}
                    onChange={() => {
                      setMode("blur");
                      setPrepared(null);
                    }}
                  />
                ),
              }}
            />
          </label>
          <label className="flex items-center gap-2">
            <UiCopy
              source="<part1></part1>Crop to fit · trim edges"
              components={{
                part1: (
                  <input
                    type="radio"
                    name="image-fit"
                    checked={mode === "crop"}
                    onChange={() => {
                      setMode("crop");
                      setPrepared(null);
                    }}
                  />
                ),
              }}
            />
          </label>
        </fieldset>
        <div className="space-y-6">
          {imageSlots(source, copy).map((slot) => {
            const preview = previews.find((candidate) => candidate.key === slot.key);
            return (
              <div key={slot.key} className="space-y-2">
                <p className="text-sm font-medium">{slot.label}</p>
                <div className="grid grid-cols-2 gap-3">
                  <figure>
                    <img
                      src={slot.url}
                      alt={copy("Original {{image}}", { image: slot.label })}
                      className="h-56 w-full object-contain rounded-lg bg-muted"
                    />
                    <figcaption className="text-xs text-muted-foreground mt-1">{copy("Original")}</figcaption>
                  </figure>
                  {preview ? (
                    <figure>
                      <img
                        src={preview.url}
                        alt={copy("Fitted {{image}}", { image: slot.label })}
                        className="h-56 w-full object-contain rounded-lg bg-muted"
                      />
                      <figcaption className="text-xs text-muted-foreground mt-1">
                        {preview.url === slot.url
                          ? copy("Already fits · unchanged")
                          : mode === "crop"
                            ? copy("Cropped to fit")
                            : copy("Fitted with blurred padding")}
                      </figcaption>
                    </figure>
                  ) : (
                    <div className="h-56 rounded-lg border border-dashed flex items-center justify-center text-sm text-muted-foreground">
                      {copy("Generate a preview")}{" "}
                    </div>
                  )}
                </div>
                <label className="text-sm">
                  <UiCopy
                    source="Swap image <part1></part1>"
                    components={{
                      part1: (
                        <input
                          aria-label={copy("Swap {{image}}", { image: slot.label })}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,image/gif"
                          disabled={busy}
                          className="block mt-1 text-sm"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void replace(slot.key, file);
                          }}
                        />
                      ),
                    }}
                  />
                </label>
              </div>
            );
          })}
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {prepared && remaining.length > 0 && (
          <div className="text-sm text-muted-foreground">
            <p>{copy("These issues still need attention before posting:")}</p>
            {remaining.map((issue, index) => (
              <p key={index}>
                {issue.platform}: {issue.message}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            {copy("Cancel")}{" "}
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void generate()}>
            {busy ? copy("Preparing images…") : copy("Generate preview")}
          </Button>
          <Button
            type="button"
            disabled={busy || !prepared}
            onClick={() => {
              if (prepared) onApply(prepared);
            }}>
            {copy("Use these images")}{" "}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
