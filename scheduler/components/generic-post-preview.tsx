"use client";

import { Video } from "lucide-react";

import type { MediaFile, ThreadSegment } from "@/types";

interface GenericPostPreviewProps {
  message: string;
  media: MediaFile[];
  thread?: ThreadSegment[];
}

function SegmentPreview({ message, media }: { message: string; media: MediaFile[] }) {
  return (
    <div className="space-y-3">
      <div className="text-sm whitespace-pre-wrap break-words text-foreground leading-relaxed">
        {message || <span className="text-muted-foreground italic">Your post will appear here…</span>}
      </div>

      {media.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {media.map((file) => (
            <div
              key={file.id}
              className="relative aspect-video rounded-lg overflow-hidden bg-secondary border border-border">
              {file.type === "image" ? (
                <img src={file.thumbnailUrl || file.url} alt={file.filename} className="w-full h-full object-cover" />
              ) : file.thumbnailUrl ? (
                <>
                  <img src={file.thumbnailUrl} alt={file.filename} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Video className="h-6 w-6 text-white drop-shadow-lg" />
                  </div>
                </>
              ) : (
                <>
                  <video src={file.url} className="w-full h-full object-cover" muted />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <Video className="h-6 w-6 text-white drop-shadow-lg" />
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function GenericPostPreview({ message, media, thread }: GenericPostPreviewProps) {
  const hasThread = thread && thread.length > 0;

  return (
    <div className="space-y-3">
      <div className="section-kicker">
        <span className="section-kicker-dot" />
        <span className="section-kicker-label">Preview</span>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 space-y-0">
        <SegmentPreview message={message} media={media} />

        {hasThread && (
          <div className="mt-4 space-y-0">
            {thread.map((segment, index) => (
              <div key={index} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="w-px bg-border flex-1 my-1" />
                </div>
                <div className="flex-1 pt-3 pb-2">
                  <p className="text-[10px] font-mono uppercase tracking-[0.08em] text-muted-foreground mb-2">
                    Post {index + 2}
                  </p>
                  <SegmentPreview message={segment.message} media={segment.media ?? []} />
                </div>
              </div>
            ))}
          </div>
        )}

        {!message && !hasThread && (
          <div className="mt-3 rounded-lg border border-dashed border-border bg-secondary/40 p-4 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            No media attached
          </div>
        )}
      </div>
    </div>
  );
}
