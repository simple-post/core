import type { ReactNode, ReactEventHandler } from "react";

import { AlertCircle, FileText, Quote } from "lucide-react";

import { PlatformIconBadge } from "../platform-icons";
import { Badge } from "../ui/badge";
export type PostCardData = {
  message: string;
  status: string;
  quotePostId?: string | null;
  media: Array<{ type: string; url: string; thumbnailUrl?: string | null; filename?: string }>;
};
export function PostCardView({
  post,
  platforms: uniquePlatforms,
  dateLabel,
  accountLabels,
  actions,
  selection,
  onImageError,
}: {
  post: PostCardData;
  platforms: string[];
  dateLabel: string;
  accountLabels: string[];
  actions?: ReactNode;
  selection?: ReactNode;
  onImageError?: ReactEventHandler<HTMLImageElement>;
}) {
  const hasMedia = post.media.length > 0;
  const isFailed = post.status === "failed";
  const isDraft = post.status === "draft";
  return (
    <div className="simplepost-visual border border-border rounded-2xl p-4 bg-card card-accent-hover">
      <div className="flex gap-4">
        {selection}
        <div className="flex-shrink-0 relative">
          {hasMedia ? (
            <div className="w-20 h-20 bg-secondary border border-border rounded-xl relative overflow-hidden">
              {post.media[0].thumbnailUrl || post.media[0].type === "image" ? (
                <img
                  src={post.media[0].thumbnailUrl || post.media[0].url}
                  alt={post.media[0].filename ?? ""}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(event) => {
                    if (onImageError) onImageError(event);
                    else event.currentTarget.style.visibility = "hidden";
                  }}
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-secondary gap-1">
                  <svg
                    className="h-10 w-10 text-muted-foreground"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-[10px] text-muted-foreground">Video</span>
                </div>
              )}
              {post.media.length > 1 && (
                <div className="absolute top-1.5 right-1.5 h-5 w-5 bg-foreground/90 backdrop-blur-sm text-background rounded-full text-xs flex items-center justify-center shadow-md font-medium">
                  {post.media.length}
                </div>
              )}
              {post.media[0].type === "video" && post.media[0].thumbnailUrl && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                    <svg className="h-4 w-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="w-20 h-20 bg-secondary border border-border rounded-xl flex items-center justify-center">
              <svg className="h-10 w-10 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}
          {/* Platform indicator */}
          {uniquePlatforms.length > 0 && (
            <div className="absolute -bottom-1 -right-1 flex max-w-[5.5rem] flex-wrap justify-end gap-0.5">
              {uniquePlatforms.map((platform) => (
                <PlatformIconBadge key={platform} platform={platform} />
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <p className="text-sm text-foreground line-clamp-2 flex-1">{post.message || "No message"}</p>
                {isFailed && (
                  <Badge variant="destructive" className="flex-shrink-0 text-xs">
                    <AlertCircle className="h-3 w-3 mr-1" />
                    Failed
                  </Badge>
                )}
                {isDraft && (
                  <Badge variant="secondary" className="flex-shrink-0 text-xs">
                    <FileText className="h-3 w-3 mr-1" />
                    Draft
                  </Badge>
                )}
                {post.quotePostId && (
                  <Badge variant="outline" className="flex-shrink-0 text-xs">
                    <Quote className="h-3 w-3 mr-1" />
                    Quote
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{dateLabel}</span>
              </div>

              <div className="flex flex-wrap gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em]">
                {accountLabels.map((label, index) => (
                  <span key={index} className="text-muted-foreground">
                    {label}
                    {index < accountLabels.length - 1 ? " · " : ""}
                  </span>
                ))}
              </div>
            </div>

            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
