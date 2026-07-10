"use client";

import type React from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";

import { normalizeContentType } from "@simple-post/sdk/media-types";
import { Upload, X, Video, ImageIcon, Images, AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { logClientError, logClientWarning } from "@/lib/logger/client";
import { generateThumbnail } from "@/lib/utils/client-thumbnail";
import type { MediaFile } from "@/types";

interface UploadingFile {
  id: string;
  filename: string;
  progress: number;
  type: "image" | "video";
}

interface MediaUploadProps {
  media: MediaFile[];
  onMediaChange: (media: MediaFile[]) => void;
  maxFiles?: number;
  maxFileSize?: number; // in bytes
  acceptedTypes?: string[];
  compact?: boolean;
}

export interface MediaUploadHandle {
  processFiles: (files: FileList | File[]) => Promise<void>;
}

const IMAGE_TYPE_TO_EXTENSION: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const resolveContentType = (file: File) => normalizeContentType(file.type || "", file.name);

// Like normalizeContentType, but always yields a string for startsWith checks.
const contentTypeOf = (type: string, name = "") => normalizeContentType(type, name) ?? "";

const withClipboardImageName = (file: File, index: number) => {
  if (file.name) {
    return file;
  }

  const contentType = contentTypeOf(file.type || "image/png", file.name) || "image/png";
  const extension = IMAGE_TYPE_TO_EXTENSION[contentType] ?? "png";

  return new File([file], `pasted-image-${Date.now()}-${index + 1}.${extension}`, {
    type: contentType,
    lastModified: file.lastModified,
  });
};

async function getVideoDurationSec(file: File, contentType: string): Promise<number | undefined> {
  if (!contentType.startsWith("video/")) {
    return undefined;
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute("src");
      video.load();
    };

    video.preload = "metadata";
    video.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(video.duration) ? video.duration : undefined;
      cleanup();
      resolve(duration);
    });
    video.addEventListener("error", () => {
      cleanup();
      resolve(undefined);
    });
    video.src = objectUrl;
  });
}

export function getClipboardImageFiles(clipboardData: DataTransfer): File[] {
  const itemFiles = [...clipboardData.items]
    .filter((item) => item.kind === "file" && contentTypeOf(item.type).startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      return file ? withClipboardImageName(file, index) : null;
    })
    .filter((file): file is File => file !== null);

  if (itemFiles.length > 0) {
    return itemFiles;
  }

  return [...clipboardData.files]
    .filter((file) => contentTypeOf(file.type, file.name).startsWith("image/"))
    .map((file, index) => withClipboardImageName(file, index));
}

async function getPresignedUrl(
  filename: string,
  contentType: string,
  size: number,
  isThumbnail: boolean = false,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const response = await fetch("/api/v1/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, size, isThumbnail }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || "Failed to get presigned URL");
  }

  return response.json();
}

async function uploadToR2(uploadUrl: string, file: File | Blob, contentType: string): Promise<void> {
  try {
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: file,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Upload failed (${response.status}): ${text || response.statusText}`);
    }
  } catch (error) {
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      // This is likely a CORS issue - fall back to server-side upload
      throw new Error("CORS_ERROR");
    }
    throw error;
  }
}

async function uploadViaServer(file: File | Blob, filename: string): Promise<{ url: string; thumbnailUrl?: string }> {
  const formData = new FormData();
  formData.append("file", file, filename);

  const response = await fetch("/api/v1/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || data.message || "Failed to upload file");
  }

  return response.json();
}

function CircularProgress({ progress, type }: { progress: number; type: "image" | "video" }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center">
      <svg className="h-14 w-14 -rotate-90" viewBox="0 0 48 48">
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          className="text-muted-foreground/20"
        />
        <circle
          cx="24"
          cy="24"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="text-foreground transition-all duration-300"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {type === "image" ? (
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Video className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-[10px] text-muted-foreground mt-0.5">{progress}%</span>
      </div>
    </div>
  );
}

export const MediaUpload = forwardRef<MediaUploadHandle, MediaUploadProps>(function MediaUpload(
  {
    media,
    onMediaChange,
    maxFiles = 10,
    maxFileSize = 50 * 1024 * 1024, // 50MB
    acceptedTypes = ["image/*", "video/*"],
    compact = false,
  },
  ref,
) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);

  const validateFile = useCallback(
    (file: File): string | null => {
      if (file.size > maxFileSize) {
        return `${file.name} is too large. Maximum size is ${Math.round(maxFileSize / (1024 * 1024))}MB.`;
      }

      const resolvedType = resolveContentType(file);
      if (!resolvedType) {
        return `${file.name} is not a supported file type.`;
      }

      const isValidType = acceptedTypes.some((type) => {
        if (type.endsWith("/*")) {
          return resolvedType.startsWith(type.slice(0, -1));
        }
        return resolvedType === type;
      });

      if (!isValidType) {
        return `${file.name} is not a supported file type.`;
      }

      return null;
    },
    [acceptedTypes, maxFileSize],
  );

  const uploadFile = useCallback(async (file: File): Promise<MediaFile | null> => {
    const id = crypto.randomUUID();
    const resolvedContentType = resolveContentType(file);
    if (!resolvedContentType) {
      throw new Error("Unsupported file type");
    }
    const mediaType: "image" | "video" = resolvedContentType.startsWith("video/") ? "video" : "image";
    const durationSec = await getVideoDurationSec(file, resolvedContentType);

    // Add to uploading state
    setUploading((prev) => [...prev, { id, filename: file.name, progress: 0, type: mediaType }]);

    try {
      let publicUrl: string;
      let thumbnailUrl: string | undefined;

      // Try direct R2 upload first, fall back to server-side upload if needed
      try {
        // Step 1: Get presigned URL for main file (10% progress)
        setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 10 } : u)));
        const { uploadUrl, publicUrl: presignedPublicUrl } = await getPresignedUrl(
          file.name,
          resolvedContentType,
          file.size,
        );

        // Step 2: Upload main file to R2 (60% progress)
        setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 30 } : u)));
        await uploadToR2(uploadUrl, file, resolvedContentType);
        setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 60 } : u)));
        publicUrl = presignedPublicUrl;

        // Step 3: Generate and upload thumbnail (90% progress)
        try {
          const thumbnailBlob = await generateThumbnail(file);
          if (thumbnailBlob) {
            setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 75 } : u)));
            const { uploadUrl: thumbUploadUrl, publicUrl: thumbPublicUrl } = await getPresignedUrl(
              file.name,
              "image/jpeg",
              thumbnailBlob.size,
              true,
            );
            await uploadToR2(thumbUploadUrl, thumbnailBlob, "image/jpeg");
            thumbnailUrl = thumbPublicUrl;
          }
        } catch (error) {
          // Thumbnail generation failed, continue without it
          logClientWarning("Thumbnail generation failed", { filename: file.name, error });
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        logClientWarning("Direct upload failed. Falling back to server upload.", {
          filename: file.name,
          reason,
        });
        setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 30 } : u)));
        const result = await uploadViaServer(file, file.name);
        publicUrl = result.url;
        thumbnailUrl = result.thumbnailUrl;
        setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 90 } : u)));
      }

      setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 100 } : u)));

      // Remove from uploading state
      setUploading((prev) => prev.filter((u) => u.id !== id));

      return {
        id,
        url: publicUrl,
        thumbnailUrl,
        type: mediaType,
        filename: file.name,
        size: file.size,
        durationSec,
      };
    } catch (error) {
      // Remove from uploading state
      setUploading((prev) => prev.filter((u) => u.id !== id));
      throw error;
    }
  }, []);

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const newErrors: string[] = [];
      const filesToUpload: File[] = [];

      // Validate all files first
      for (const file of files) {
        if (media.length + uploading.length + filesToUpload.length >= maxFiles) {
          newErrors.push(`Maximum ${maxFiles} files allowed.`);
          break;
        }

        const error = validateFile(file);
        if (error) {
          newErrors.push(error);
          continue;
        }

        filesToUpload.push(file);
      }

      setErrors(newErrors);

      if (filesToUpload.length === 0) {
        return;
      }

      // Upload files in parallel
      const uploadPromises = filesToUpload.map(async (file) => {
        try {
          return await uploadFile(file);
        } catch (error) {
          logClientError(error, "Failed to upload media file", { filename: file.name, size: file.size });
          setErrors((prev) => [...prev, `Failed to upload ${file.name}: ${(error as Error).message}`]);
          return null;
        }
      });

      const results = await Promise.all(uploadPromises);
      const successfulUploads = results.filter((r): r is MediaFile => r !== null);

      if (successfulUploads.length > 0) {
        onMediaChange([...media, ...successfulUploads]);
      }
    },
    [media, uploading.length, maxFiles, onMediaChange, uploadFile, validateFile],
  );

  useImperativeHandle(ref, () => ({ processFiles }), [processFiles]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files) {
      processFiles(files);
    }
    // Reset input value to allow selecting the same file again
    event.target.value = "";
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files);
    }
  };

  const removeMedia = (id: string) => {
    onMediaChange(media.filter((m) => m.id !== id));
    setErrors([]); // Clear errors when removing files
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const isUploading = uploading.length > 0;
  const totalFiles = media.length + uploading.length;

  const canAddMore = totalFiles < maxFiles && !isUploading;

  // Compact add button (shown in grid when there's already media)
  const cannotAddMore = !canAddMore;
  const compactAddButton = (
    <div
      className={`relative aspect-square border border-dashed rounded-lg transition-colors ${
        dragActive ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80 bg-card"
      } ${cannotAddMore ? "pointer-events-none opacity-50" : ""}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      aria-disabled={cannotAddMore}
      onKeyDown={handleKeyDown}>
      <input
        type="file"
        multiple
        accept={acceptedTypes.join(",")}
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={cannotAddMore}
        ref={fileInputRef}
      />
      <div className="flex flex-col items-center justify-center h-full text-center p-2">
        <Upload className={`h-6 w-6 mb-1 ${dragActive ? "text-foreground" : "text-muted-foreground"}`} />
        <p className="text-xs text-muted-foreground">Add more</p>
      </div>
    </div>
  );

  // Large upload area (shown when no media)
  const largeUploadArea = (
    <div
      className={`relative border border-dashed rounded-xl transition-colors ${
        dragActive ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80 bg-card"
      } ${isUploading ? "pointer-events-none opacity-75" : ""}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      aria-disabled={isUploading || totalFiles >= maxFiles}
      onKeyDown={handleKeyDown}>
      <input
        type="file"
        id="media-upload"
        multiple
        accept={acceptedTypes.join(",")}
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={totalFiles >= maxFiles || isUploading}
        ref={fileInputRef}
      />
      <div className="flex flex-col items-center justify-center p-6 text-center">
        {isUploading ? (
          <Loader2 className="h-8 w-8 mb-3 text-muted-foreground animate-spin" />
        ) : (
          <Upload className={`h-8 w-8 mb-3 ${dragActive ? "text-foreground" : "text-muted-foreground"}`} />
        )}
        <p className="text-sm mb-1">
          {isUploading ? "Uploading..." : dragActive ? "Drop files here" : "Click to upload or drag and drop"}
        </p>
        <p className="text-xs text-muted-foreground">
          Images and videos up to {Math.round(maxFileSize / (1024 * 1024))}MB each
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {totalFiles}/{maxFiles} files {isUploading ? "(uploading)" : "selected"}
        </p>
      </div>
    </div>
  );

  // Strip upload area — used in compact mode when there's no media yet
  const stripUploadArea = (
    <div
      className={`relative flex items-center gap-2 px-3 py-2 border border-dashed rounded-lg transition-colors ${
        dragActive ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80"
      } ${isUploading ? "pointer-events-none opacity-75" : "cursor-pointer"}`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={handleDrop}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}>
      <input
        type="file"
        multiple
        accept={acceptedTypes.join(",")}
        onChange={handleFileInput}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        disabled={isUploading}
        ref={fileInputRef}
      />
      {isUploading ? (
        <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin flex-shrink-0" />
      ) : (
        <Images className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
      )}
      <span className="text-xs text-muted-foreground">{isUploading ? "Uploading…" : "Add media"}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Show upload area when no media and nothing uploading */}
      {media.length === 0 && uploading.length === 0 && (compact ? stripUploadArea : largeUploadArea)}

      {/* Error Messages */}
      {errors.length > 0 && (
        <div className="border border-destructive/50 bg-destructive/5 rounded p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              {errors.map((error, index) => (
                <p key={index} className="text-sm text-destructive">
                  {error}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Media Preview Grid with uploading cards and compact add button */}
      {(media.length > 0 || uploading.length > 0) && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {media.map((file) => (
            <div key={file.id} className="relative group overflow-hidden border border-border rounded-lg">
              <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden relative">
                {file.type === "image" ? (
                  <img
                    src={file.thumbnailUrl || file.url || "/placeholder.svg"}
                    alt={file.filename}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = "/broken-image.png";
                    }}
                  />
                ) : (
                  <>
                    {file.thumbnailUrl ? (
                      <img
                        src={file.thumbnailUrl}
                        alt={file.filename}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement;
                          target.src = "/broken-image.png";
                        }}
                      />
                    ) : (
                      <video
                        src={file.url}
                        className="w-full h-full object-cover"
                        muted
                        playsInline
                        onError={() => {}}
                      />
                    )}
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <Video className="h-8 w-8 text-white drop-shadow-lg" />
                    </div>
                  </>
                )}
              </div>

              {/* File Info Overlay */}
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="text-xs truncate">{file.filename}</p>
                <p className="text-xs text-gray-300">{formatFileSize(file.size)}</p>
              </div>

              {/* Remove Button */}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                className="absolute top-2 right-2 h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeMedia(file.id)}>
                <X className="h-3 w-3" />
              </Button>

              {/* File Type Icon */}
              <div className="absolute top-2 left-2 opacity-75">
                {file.type === "image" ? (
                  <ImageIcon className="h-3 w-3 text-white drop-shadow-sm" />
                ) : (
                  <Video className="h-3 w-3 text-white drop-shadow-sm" />
                )}
              </div>
            </div>
          ))}

          {/* Uploading cards with circular progress */}
          {uploading.map((file) => (
            <div key={file.id} className="relative overflow-hidden border border-border rounded-lg">
              <div className="aspect-square bg-muted/50 flex items-center justify-center">
                <CircularProgress progress={file.progress} type={file.type} />
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-2">
                <p className="text-xs truncate">{file.filename}</p>
              </div>
            </div>
          ))}

          {/* Compact add button at the end of the grid */}
          {canAddMore && compactAddButton}
        </div>
      )}
    </div>
  );
});
