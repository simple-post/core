"use client";

import { Video } from "lucide-react";

import { Card } from "@/components/ui/card";
import type { MediaFile } from "@/types";

interface GenericPostPreviewProps {
  message: string;
  media: MediaFile[];
}

export function GenericPostPreview({ message, media }: GenericPostPreviewProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">Preview</h3>
      <Card className="p-4 space-y-4 border-border/50">
        <div className="text-sm whitespace-pre-wrap break-words">
          {message ? message : <span className="text-muted-foreground italic">Your post will appear here...</span>}
        </div>

        {media.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {media.map((file) => (
              <div key={file.id} className="relative aspect-video rounded overflow-hidden bg-muted">
                {file.type === "image" ? (
                  <img src={file.thumbnailUrl || file.url} alt={file.filename} className="w-full h-full object-cover" />
                ) : file.thumbnailUrl ? (
                  <>
                    <img src={file.thumbnailUrl} alt={file.filename} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Video className="h-6 w-6 text-white drop-shadow-lg" />
                    </div>
                  </>
                ) : (
                  <>
                    <video src={file.url} className="w-full h-full object-cover" muted />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                      <Video className="h-6 w-6 text-white drop-shadow-lg" />
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded border border-dashed border-border/60 bg-muted/30 p-4 text-xs text-muted-foreground">
            No media attached
          </div>
        )}
      </Card>
    </div>
  );
}
