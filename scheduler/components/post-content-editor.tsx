"use client";

import type React from "react";
import { useCallback, useRef } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { getMainFieldCharCounterState } from "@/lib/message-length-ui";
import type { MediaFile, ThreadSegment } from "@/types";

import { getClipboardImageFiles, MediaUpload, type MediaUploadHandle } from "./media-upload";
import { ThreadSegmentsEditor } from "./thread-segments-editor";

type CharCounterState = ReturnType<typeof getMainFieldCharCounterState>;

interface PostContentEditorProps {
  id: string;
  message: string;
  onMessageChange: (message: string) => void;
  media: MediaFile[];
  onMediaChange: (media: MediaFile[]) => void;
  /** Omit to hide follow-up posts, e.g. for a platform without threads. */
  thread?: {
    segments: ThreadSegment[];
    onAdd: () => void;
    onRemove: (index: number) => void;
    onMessageChange: (index: number, message: string) => void;
    onMediaChange: (index: number, media: MediaFile[]) => void;
    maxThreadSegments?: number | null;
  };
  maxTextLength?: number;
  charCounter?: CharCounterState;
  placeholder?: string;
  /** Called when pasted images start uploading, so callers can mark the form as touched. */
  onPasteMedia?: () => void;
}

/**
 * The post composer body: message, attached media, character budget, and
 * follow-up thread posts. Shared by the new, edit, and per-account pages so
 * they look and behave the same.
 */
export function PostContentEditor({
  id,
  message,
  onMessageChange,
  media,
  onMediaChange,
  thread,
  maxTextLength,
  charCounter,
  placeholder = "What's on your mind?",
  onPasteMedia,
}: PostContentEditorProps) {
  const mediaUploadRef = useRef<MediaUploadHandle | null>(null);

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = getClipboardImageFiles(event.clipboardData);
      if (imageFiles.length > 0) {
        onPasteMedia?.();
        void mediaUploadRef.current?.processFiles(imageFiles);
      }
    },
    [onPasteMedia],
  );

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={id} className="text-sm font-medium">
          Message
        </Label>
        <Textarea
          id={id}
          placeholder={placeholder}
          value={message}
          onChange={(e) => onMessageChange(e.target.value)}
          onPaste={handlePaste}
          className="min-h-32 resize-none mt-2"
          maxLength={maxTextLength}
        />
        <div className="mt-1">
          <MediaUpload ref={mediaUploadRef} media={media} onMediaChange={onMediaChange} compact />
        </div>
        <div className="mt-2 flex flex-wrap items-baseline justify-end gap-x-2 gap-y-0.5 text-xs">
          {maxTextLength && charCounter ? (
            <>
              <span className={charCounter.countClassName}>
                {charCounter.numerator.toLocaleString()}/{charCounter.denominator.toLocaleString()}
              </span>
              {charCounter.showLongPostOnXHint ? <span className="text-muted-foreground">Long X post</span> : null}
            </>
          ) : (
            <span className="text-muted-foreground">{message.length.toLocaleString()}</span>
          )}
        </div>
      </div>

      {thread ? (
        <ThreadSegmentsEditor
          thread={thread.segments}
          onAdd={thread.onAdd}
          onRemove={thread.onRemove}
          onMessageChange={thread.onMessageChange}
          onMediaChange={thread.onMediaChange}
          onPasteMedia={onPasteMedia}
          maxThreadSegments={thread.maxThreadSegments}
        />
      ) : null}
    </div>
  );
}
