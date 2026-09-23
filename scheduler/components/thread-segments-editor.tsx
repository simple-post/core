"use client";

import type React from "react";
import { useCallback, useRef } from "react";

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { MediaFile, ThreadSegment } from "@/types";

import { getClipboardImageFiles, MediaUpload, type MediaUploadHandle } from "./media-upload";

interface ThreadSegmentsEditorProps {
  thread: ThreadSegment[];
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMessageChange: (index: number, message: string) => void;
  onMediaChange: (index: number, media: MediaFile[]) => void;
  /** Called when pasted images start uploading into a segment. */
  onPasteMedia?: () => void;
  /** Disables adding once the trial thread limit is reached. */
  maxThreadSegments?: number | null;
}

/** Follow-up posts after a root message, shared by the common composer and per-account customization. */
export function ThreadSegmentsEditor({
  thread,
  onAdd,
  onRemove,
  onMessageChange,
  onMediaChange,
  onPasteMedia,
  maxThreadSegments,
}: ThreadSegmentsEditorProps) {
  const mediaUploadRefs = useRef<Array<MediaUploadHandle | null>>([]);
  const atLimit = maxThreadSegments != null && thread.length + 1 >= maxThreadSegments;

  const handlePaste = useCallback(
    (index: number, event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = getClipboardImageFiles(event.clipboardData);
      if (imageFiles.length > 0) {
        onPasteMedia?.();
        void mediaUploadRefs.current[index]?.processFiles(imageFiles);
      }
    },
    [onPasteMedia],
  );

  return (
    <>
      {thread.length > 0 && (
        <div className="space-y-0">
          {thread.map((segment, index) => (
            <div key={index} className="flex gap-3">
              <div className="flex flex-col items-center pt-1">
                <div className="w-px bg-border flex-1" />
              </div>
              <div className="flex-1 space-y-2 pb-4 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono uppercase tracking-[0.08em] text-muted-foreground">
                    Post {index + 2}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove post ${index + 2}`}
                    onClick={() => onRemove(index)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Textarea
                  placeholder="Continue your thread…"
                  value={segment.message}
                  onChange={(e) => onMessageChange(index, e.target.value)}
                  onPaste={(event) => handlePaste(index, event)}
                  className="min-h-20 resize-none text-sm"
                />
                <MediaUpload
                  ref={(node) => {
                    mediaUploadRefs.current[index] = node;
                  }}
                  media={segment.media ?? []}
                  onMediaChange={(m) => onMediaChange(index, m)}
                  compact
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        disabled={atLimit}
        onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        {atLimit ? `Thread limit (${maxThreadSegments})` : "Add to thread"}
      </Button>
    </>
  );
}
