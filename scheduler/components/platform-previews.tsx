"use client";

import type { MediaFile } from "@/lib/types";
import { Card } from "@/components/ui/card";
import { Play, Heart, MessageCircle, Repeat2, Share, Bookmark, MoreHorizontal } from "lucide-react";

interface PlatformPreviewProps {
  message: string;
  media: MediaFile[];
  platform: string;
}

export function XPreview({ message, media }: PlatformPreviewProps) {
  return (
    <Card className="p-3 bg-background max-w-md">
      <div className="flex gap-2">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          {/* Header */}
          <div className="flex items-center gap-1 text-xs">
            <span className="font-semibold">Your Account</span>
            <span className="text-muted-foreground">@youraccount</span>
            <span className="text-muted-foreground">· 1m</span>
          </div>

          {/* Content */}
          <div className="mt-1 text-xs whitespace-pre-wrap break-words line-clamp-3">
            {message || <span className="text-muted-foreground italic">Your tweet will appear here...</span>}
          </div>

          {/* Media */}
          {media.length > 0 && (
            <div
              className={`mt-3 rounded-2xl overflow-hidden border border-border ${
                media.length === 1 ? "" : "grid grid-cols-2 gap-0.5"
              }`}>
              {media.slice(0, 4).map((file, idx) => (
                <div
                  key={file.id}
                  className={`relative bg-muted ${media.length === 1 ? "aspect-video" : "aspect-square"}`}>
                  {file.type === "image" ? (
                    <img src={file.url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <>
                      <video src={file.url} className="w-full h-full object-cover" muted />
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <Play className="h-8 w-8 text-white drop-shadow-lg fill-white" />
                      </div>
                    </>
                  )}
                  {idx === 3 && media.length > 4 && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
                      <span className="text-white text-xl font-semibold">+{media.length - 4}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between mt-2 text-muted-foreground">
            <button className="flex items-center gap-1 hover:text-blue-500 transition-colors">
              <MessageCircle className="h-3 w-3" />
            </button>
            <button className="flex items-center gap-1 hover:text-green-500 transition-colors">
              <Repeat2 className="h-3 w-3" />
            </button>
            <button className="flex items-center gap-1 hover:text-red-500 transition-colors">
              <Heart className="h-3 w-3" />
            </button>
            <button className="flex items-center gap-1 hover:text-blue-500 transition-colors">
              <Share className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export function InstagramPreview({ message, media }: PlatformPreviewProps) {
  return (
    <Card className="p-0 bg-background max-w-xs">
      {/* Header */}
      <div className="flex items-center gap-2 p-2 border-b">
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-400 via-pink-500 to-orange-400" />
        <span className="font-semibold text-xs">youraccount</span>
        <MoreHorizontal className="h-4 w-4 ml-auto text-muted-foreground" />
      </div>

      {/* Media */}
      {media.length > 0 ? (
        <div className="relative bg-black aspect-square">
          {media[0].type === "image" ? (
            <img src={media[0].url} alt="" className="w-full h-full object-contain" />
          ) : (
            <>
              <video src={media[0].url} className="w-full h-full object-contain" muted />
              <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                <Play className="h-12 w-12 text-white drop-shadow-lg fill-white" />
              </div>
            </>
          )}
          {media.length > 1 && (
            <div className="absolute top-3 right-3 bg-black/60 text-white px-2 py-1 rounded-full text-xs font-medium">
              1/{media.length}
            </div>
          )}
        </div>
      ) : (
        <div className="aspect-square bg-muted flex items-center justify-center">
          <span className="text-muted-foreground text-sm">No media</span>
        </div>
      )}

      {/* Actions */}
      <div className="p-2 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Heart className="h-4 w-4" />
            <MessageCircle className="h-4 w-4" />
            <Share className="h-4 w-4" />
          </div>
          <Bookmark className="h-4 w-4" />
        </div>

        {/* Caption */}
        {message && (
          <div className="text-xs line-clamp-2">
            <span className="font-semibold mr-1">youraccount</span>
            <span className="whitespace-pre-wrap break-words">{message}</span>
          </div>
        )}
        {!message && <span className="text-xs text-muted-foreground italic">Your caption will appear here...</span>}
      </div>
    </Card>
  );
}

export function FacebookPreview({ message, media }: PlatformPreviewProps) {
  return (
    <Card className="p-0 bg-background max-w-md">
      {/* Header */}
      <div className="p-2 pb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-600" />
          <div className="flex-1">
            <div className="font-semibold text-xs">Your Page</div>
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">Just now · 🌎</div>
          </div>
          <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Content */}
        {message && <div className="mt-2 text-xs whitespace-pre-wrap break-words line-clamp-3">{message}</div>}
        {!message && <div className="mt-2 text-xs text-muted-foreground italic">Your post will appear here...</div>}
      </div>

      {/* Media */}
      {media.length > 0 && (
        <div className="relative bg-black">
          {media[0].type === "image" ? (
            <img src={media[0].url} alt="" className="w-full aspect-[4/3] object-cover" />
          ) : (
            <>
              <video src={media[0].url} className="w-full aspect-[4/3] object-cover" muted />
              <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                <Play className="h-16 w-16 text-white drop-shadow-lg fill-white" />
              </div>
            </>
          )}
          {media.length > 1 && (
            <div className="absolute top-3 right-3 bg-black/80 text-white px-3 py-1 rounded text-sm font-medium">
              +{media.length - 1}
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="border-t border-border">
        <div className="grid grid-cols-3 text-[10px] font-medium text-muted-foreground">
          <button className="flex items-center justify-center gap-1 py-1.5 hover:bg-muted/50">
            <Heart className="h-3 w-3" />
            Like
          </button>
          <button className="flex items-center justify-center gap-1 py-1.5 hover:bg-muted/50">
            <MessageCircle className="h-3 w-3" />
            Comment
          </button>
          <button className="flex items-center justify-center gap-1 py-1.5 hover:bg-muted/50">
            <Share className="h-3 w-3" />
            Share
          </button>
        </div>
      </div>
    </Card>
  );
}

export function TikTokPreview({ message, media }: PlatformPreviewProps) {
  return (
    <Card className="p-0 bg-black text-white overflow-hidden max-w-[200px]">
      <div className="relative aspect-[9/16]">
        {/* Video Background */}
        {media.length > 0 ? (
          media[0].type === "video" ? (
            <>
              <video src={media[0].url} className="w-full h-full object-cover" muted />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
            </>
          ) : (
            <>
              <img src={media[0].url} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/60" />
            </>
          )
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-pink-500 via-purple-500 to-blue-500" />
        )}

        {/* Overlay Content */}
        <div className="absolute bottom-0 left-0 right-0 p-2 space-y-1">
          {/* User Info */}
          <div className="flex items-center gap-1">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-pink-400 to-purple-600 border border-white" />
            <span className="font-semibold text-white drop-shadow-lg text-[10px]">@youraccount</span>
          </div>

          {/* Caption */}
          {message && <div className="text-[10px] text-white drop-shadow-lg line-clamp-2">{message}</div>}
          {!message && (
            <div className="text-[10px] text-white/70 italic drop-shadow-lg">Your caption will appear here...</div>
          )}
        </div>

        {/* Side Actions */}
        <div className="absolute right-2 bottom-16 space-y-2">
          <button className="flex flex-col items-center gap-0.5">
            <Heart className="h-5 w-5 text-white drop-shadow-lg" />
            <span className="text-[8px] text-white drop-shadow-lg">123</span>
          </button>
          <button className="flex flex-col items-center gap-0.5">
            <MessageCircle className="h-5 w-5 text-white drop-shadow-lg" />
            <span className="text-[8px] text-white drop-shadow-lg">45</span>
          </button>
          <button className="flex flex-col items-center gap-0.5">
            <Share className="h-5 w-5 text-white drop-shadow-lg" />
            <span className="text-[8px] text-white drop-shadow-lg">67</span>
          </button>
        </div>

        {/* Play Button */}
        {media.length > 0 && media[0].type === "video" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Play className="h-10 w-10 text-white/80 drop-shadow-xl fill-white/80" />
          </div>
        )}
      </div>
    </Card>
  );
}

export function YouTubePreview({ message, media }: PlatformPreviewProps) {
  return (
    <Card className="p-0 bg-background max-w-sm">
      {/* Thumbnail */}
      {media.length > 0 ? (
        <div className="relative aspect-video bg-black">
          {media[0].type === "video" ? (
            <>
              <video src={media[0].url} className="w-full h-full object-cover" muted />
              <div className="absolute inset-0 bg-black/20" />
            </>
          ) : (
            <img src={media[0].url} alt="" className="w-full h-full object-cover" />
          )}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="bg-red-600 rounded-full p-2">
              <Play className="h-5 w-5 text-white fill-white ml-0.5" />
            </div>
          </div>
          <div className="absolute bottom-1 right-1 bg-black/80 text-white px-1 py-0.5 text-[10px] font-medium rounded">
            4:20
          </div>
        </div>
      ) : (
        <div className="aspect-video bg-muted flex items-center justify-center">
          <span className="text-muted-foreground text-xs">No video</span>
        </div>
      )}

      {/* Info */}
      <div className="p-2 space-y-1">
        <div className="flex gap-2">
          <div className="w-6 h-6 rounded-full bg-red-600 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            {/* Title (from message first line or "Your video title") */}
            <h3 className="font-semibold text-xs line-clamp-2">
              {message ? message.split("\n")[0] : "Your video title will appear here..."}
            </h3>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground mt-0.5">
              <span>Your Channel</span>
              <span>·</span>
              <span>0 views</span>
            </div>
          </div>
          <MoreHorizontal className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        </div>
      </div>
    </Card>
  );
}

export function TelegramPreview({ message, media }: PlatformPreviewProps) {
  return (
    <Card className="p-0 bg-background max-w-sm">
      <div className="p-2 space-y-1">
        {/* Header */}
        <div className="flex items-center gap-1.5 pb-1">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600" />
          <div>
            <div className="font-semibold text-xs">Your Channel</div>
            <div className="text-[10px] text-muted-foreground">@yourchannel</div>
          </div>
        </div>

        {/* Media */}
        {media.length > 0 && (
          <div className="relative rounded overflow-hidden bg-muted -mx-2">
            {media[0].type === "image" ? (
              <img src={media[0].url} alt="" className="w-full aspect-video object-cover" />
            ) : (
              <>
                <video src={media[0].url} className="w-full aspect-video object-cover" muted />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <Play className="h-8 w-8 text-white drop-shadow-lg fill-white" />
                </div>
              </>
            )}
          </div>
        )}

        {/* Message */}
        <div className="text-xs line-clamp-2">
          {message ? (
            <p className="whitespace-pre-wrap break-words">{message}</p>
          ) : (
            <p className="text-muted-foreground italic">Your message will appear here...</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-0.5">
          <span>Just now</span>
          <span>👁 0</span>
        </div>
      </div>
    </Card>
  );
}
