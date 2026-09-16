"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { MediaFile } from "@/types";

import type { ImageFit, ImageFitContent, ValidationIssue } from "@simple-post/sdk";

type ImageSlot = { key: string; label: string; url: string; replace: (url: string, file?: MediaFile) => void };

/** Locations include account overrides, thread images and video covers. */
function imageSlots(content: ImageFitContent): ImageSlot[] {
  const slots: ImageSlot[] = [];
  const add = (media: MediaFile[] | undefined, prefix: string) => {
    for (const [index, item] of (media ?? []).entries()) {
      if (item.type === "image")
        slots.push({
          key: `${prefix}.${index}`,
          label: `${prefix} · image ${index + 1}`,
          url: item.url,
          replace: (url, file) => Object.assign(item, file ?? { url }),
        });
      else if (item.thumbnailUrl)
        slots.push({
          key: `${prefix}.${index}.cover`,
          label: `${prefix} · video cover`,
          url: item.thumbnailUrl,
          replace: (url) => {
            item.thumbnailUrl = url;
          },
        });
    }
  };
  add(content.media, "Shared post");
  for (const [index, segment] of (content.thread ?? []).entries()) add(segment.media, `Thread ${index + 1}`);
  for (const [id, override] of Object.entries(content.accountOverrides ?? {})) {
    add(override.media, id);
    for (const [index, segment] of (override.thread ?? []).entries()) add(segment.media, `${id} · thread ${index + 1}`);
  }
  for (const [id, options] of Object.entries(content.accountOptions ?? {})) {
    if (typeof options?.thumbnailUrl === "string")
      slots.push({
        key: `${id}.cover`,
        label: `${id} · custom thumbnail`,
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
      if (!response.ok) throw new Error(data.error || "Could not fit these images.");
      if (!data.fittedContent) throw new Error("No fitted images were returned. Please try again.");
      setPrepared(data.fittedContent);
      setRemaining(data.summary.errors);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not fit images.");
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
      if (!response.ok) throw new Error(uploaded.error || "Could not upload replacement image.");
      const next = structuredClone(source);
      imageSlots(next)
        .find((slot) => slot.key === key)
        ?.replace(uploaded.url, { ...uploaded, id: crypto.randomUUID(), type: "image", filename: file.name });
      setSource(next);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not replace image.");
    } finally {
      setBusy(false);
    }
  }

  const previews = prepared ? imageSlots(prepared) : [];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Fit images for your platforms</DialogTitle>
          <DialogDescription>
            Review the result before using it. Originals stay unchanged. Images are converted to JPEG when needed;
            animations that need fitting become still images.
          </DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="flex flex-wrap gap-4">
          <legend className="sr-only">Fitting method</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="image-fit"
              checked={mode === "blur"}
              onChange={() => {
                setMode("blur");
                setPrepared(null);
              }}
            />
            Blurred background · keep full image
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="image-fit"
              checked={mode === "crop"}
              onChange={() => {
                setMode("crop");
                setPrepared(null);
              }}
            />
            Crop to fit · trim edges
          </label>
        </fieldset>
        <div className="space-y-6">
          {imageSlots(source).map((slot) => {
            const preview = previews.find((candidate) => candidate.key === slot.key);
            return (
              <div key={slot.key} className="space-y-2">
                <p className="text-sm font-medium">{slot.label}</p>
                <div className="grid grid-cols-2 gap-3">
                  <figure>
                    <img
                      src={slot.url}
                      alt={`Original ${slot.label}`}
                      className="h-56 w-full object-contain rounded-lg bg-muted"
                    />
                    <figcaption className="text-xs text-muted-foreground mt-1">Original</figcaption>
                  </figure>
                  {preview ? (
                    <figure>
                      <img
                        src={preview.url}
                        alt={`Fitted ${slot.label}`}
                        className="h-56 w-full object-contain rounded-lg bg-muted"
                      />
                      <figcaption className="text-xs text-muted-foreground mt-1">
                        {preview.url === slot.url
                          ? "Already fits · unchanged"
                          : mode === "crop"
                            ? "Cropped to fit"
                            : "Fitted with blurred padding"}
                      </figcaption>
                    </figure>
                  ) : (
                    <div className="h-56 rounded-lg border border-dashed flex items-center justify-center text-sm text-muted-foreground">
                      Generate a preview
                    </div>
                  )}
                </div>
                <label className="text-sm">
                  Swap image
                  <input
                    aria-label={`Swap ${slot.label}`}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    disabled={busy}
                    className="block mt-1 text-sm"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void replace(slot.key, file);
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
            <p>These issues still need attention before posting:</p>
            {remaining.map((issue, index) => (
              <p key={index}>
                {issue.platform}: {issue.message}
              </p>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void generate()}>
            {busy ? "Preparing images…" : "Generate preview"}
          </Button>
          <Button
            type="button"
            disabled={busy || !prepared}
            onClick={() => {
              if (prepared) onApply(prepared);
            }}>
            Use these images
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
