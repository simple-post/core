"use client";

import type React from "react";
import { useCallback, useState } from "react";

import { Upload, X, Video, ImageIcon, AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
}

async function getPresignedUrl(
  filename: string,
  contentType: string,
  isThumbnail: boolean = false,
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const response = await fetch("/api/upload/presign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, contentType, isThumbnail }),
  });

  if (!response.ok) {
    throw new Error("Failed to get presigned URL");
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

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || "Failed to upload file");
  }

  return response.json();
}

export function MediaUpload({
  media,
  onMediaChange,
  maxFiles = 10,
  maxFileSize = 50 * 1024 * 1024, // 50MB
  acceptedTypes = ["image/*", "video/*"],
}: MediaUploadProps) {
  const [dragActive, setDragActive] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [uploading, setUploading] = useState<UploadingFile[]>([]);

  const validateFile = (file: File): string | null => {
    if (file.size > maxFileSize) {
      return `${file.name} is too large. Maximum size is ${Math.round(maxFileSize / (1024 * 1024))}MB.`;
    }

    const isValidType = acceptedTypes.some((type) => {
      if (type.endsWith("/*")) {
        return file.type.startsWith(type.slice(0, -1));
      }
      return file.type === type;
    });

    if (!isValidType) {
      return `${file.name} is not a supported file type.`;
    }

    return null;
  };

  const uploadFile = async (file: File): Promise<MediaFile | null> => {
    const id = crypto.randomUUID();
    const mediaType: "image" | "video" = file.type.startsWith("video/") ? "video" : "image";

    // Add to uploading state
    setUploading((prev) => [...prev, { id, filename: file.name, progress: 0, type: mediaType }]);

    try {
      let publicUrl: string;
      let thumbnailUrl: string | undefined;

      // Try direct R2 upload first, fall back to server-side upload if CORS fails
      try {
        // Step 1: Get presigned URL for main file (10% progress)
        setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 10 } : u)));
        const { uploadUrl, publicUrl: presignedPublicUrl } = await getPresignedUrl(file.name, file.type);

        // Step 2: Upload main file to R2 (60% progress)
        setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 30 } : u)));
        await uploadToR2(uploadUrl, file, file.type);
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
              true,
            );
            await uploadToR2(thumbUploadUrl, thumbnailBlob, "image/jpeg");
            thumbnailUrl = thumbPublicUrl;
          }
        } catch {
          // Thumbnail generation failed, continue without it
          console.warn("Thumbnail generation failed for", file.name);
        }
      } catch (error) {
        // If CORS error, fall back to server-side upload
        if (error instanceof Error && error.message === "CORS_ERROR") {
          console.log("Direct upload failed due to CORS, falling back to server-side upload");
          setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 30 } : u)));
          const result = await uploadViaServer(file, file.name);
          publicUrl = result.url;
          thumbnailUrl = result.thumbnailUrl;
          setUploading((prev) => prev.map((u) => (u.id === id ? { ...u, progress: 90 } : u)));
        } else {
          throw error;
        }
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
      };
    } catch (error) {
      // Remove from uploading state
      setUploading((prev) => prev.filter((u) => u.id !== id));
      throw error;
    }
  };

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
    [media, uploading.length, maxFiles, maxFileSize, onMediaChange],
  );

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

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        className={`relative border border-dashed rounded transition-colors ${
          dragActive ? "border-foreground bg-muted/50" : "border-border/50 hover:border-border"
        } ${isUploading ? "pointer-events-none opacity-75" : ""}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}>
        <input
          type="file"
          id="media-upload"
          multiple
          accept={acceptedTypes.join(",")}
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={totalFiles >= maxFiles || isUploading}
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

      {/* Upload Progress */}
      {uploading.length > 0 && (
        <div className="space-y-2">
          {uploading.map((file) => (
            <div key={file.id} className="flex items-center gap-3 p-2 bg-muted/50 rounded">
              {file.type === "image" ? (
                <ImageIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              ) : (
                <Video className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs truncate">{file.filename}</p>
                <Progress value={file.progress} className="h-1 mt-1" />
              </div>
              <span className="text-xs text-muted-foreground">{file.progress}%</span>
            </div>
          ))}
        </div>
      )}

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

      {/* Media Preview Grid */}
      {media.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {media.map((file) => (
            <div key={file.id} className="relative group overflow-hidden border border-border/50 rounded">
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
        </div>
      )}
    </div>
  );
}
