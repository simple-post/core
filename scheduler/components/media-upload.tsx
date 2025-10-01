"use client"

import type React from "react"

import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Upload, X, Video, ImageIcon, AlertCircle } from "lucide-react"
import type { MediaFile } from "@/lib/types"

interface MediaUploadProps {
  media: MediaFile[]
  onMediaChange: (media: MediaFile[]) => void
  maxFiles?: number
  maxFileSize?: number // in bytes
  acceptedTypes?: string[]
}

export function MediaUpload({
  media,
  onMediaChange,
  maxFiles = 10,
  maxFileSize = 50 * 1024 * 1024, // 50MB
  acceptedTypes = ["image/*", "video/*"],
}: MediaUploadProps) {
  const [dragActive, setDragActive] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const validateFile = (file: File): string | null => {
    if (file.size > maxFileSize) {
      return `${file.name} is too large. Maximum size is ${Math.round(maxFileSize / (1024 * 1024))}MB.`
    }

    const isValidType = acceptedTypes.some((type) => {
      if (type.endsWith("/*")) {
        return file.type.startsWith(type.slice(0, -1))
      }
      return file.type === type
    })

    if (!isValidType) {
      return `${file.name} is not a supported file type.`
    }

    return null
  }

  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const newErrors: string[] = []
      const validFiles: MediaFile[] = []

      Array.from(files).forEach((file) => {
        if (media.length + validFiles.length >= maxFiles) {
          newErrors.push(`Maximum ${maxFiles} files allowed.`)
          return
        }

        const error = validateFile(file)
        if (error) {
          newErrors.push(error)
          return
        }

        const mediaFile: MediaFile = {
          id: crypto.randomUUID(),
          url: URL.createObjectURL(file),
          type: file.type.startsWith("video/") ? "video" : "image",
          filename: file.name,
          size: file.size,
        }
        validFiles.push(mediaFile)
      })

      setErrors(newErrors)
      if (validFiles.length > 0) {
        onMediaChange([...media, ...validFiles])
      }
    },
    [media, maxFiles, maxFileSize, onMediaChange],
  )

  const handleFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (files) {
      processFiles(files)
    }
    // Reset input value to allow selecting the same file again
    event.target.value = ""
  }

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files)
    }
  }

  const removeMedia = (id: string) => {
    const mediaToRemove = media.find((m) => m.id === id)
    if (mediaToRemove) {
      URL.revokeObjectURL(mediaToRemove.url)
    }
    onMediaChange(media.filter((m) => m.id !== id))
    setErrors([]) // Clear errors when removing files
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <div
        className={`relative border border-dashed rounded transition-colors ${
          dragActive ? "border-foreground bg-muted/50" : "border-border/50 hover:border-border"
        }`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <input
          type="file"
          id="media-upload"
          multiple
          accept={acceptedTypes.join(",")}
          onChange={handleFileInput}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={media.length >= maxFiles}
        />
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <Upload className={`h-8 w-8 mb-3 ${dragActive ? "text-foreground" : "text-muted-foreground"}`} />
          <p className="text-sm mb-1">{dragActive ? "Drop files here" : "Click to upload or drag and drop"}</p>
          <p className="text-xs text-muted-foreground">
            Images and videos up to {Math.round(maxFileSize / (1024 * 1024))}MB each
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {media.length}/{maxFiles} files selected
          </p>
        </div>
      </div>

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
              <div className="aspect-square bg-muted flex items-center justify-center overflow-hidden">
                {file.type === "image" ? (
                  <img
                    src={file.url || "/placeholder.svg"}
                    alt={file.filename}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement
                      target.src = "/broken-image.png"
                    }}
                  />
                ) : (
                  <div className="flex flex-col items-center p-3">
                    <Video className="h-6 w-6 text-muted-foreground mb-2" />
                    <p className="text-xs text-center text-muted-foreground line-clamp-2">{file.filename}</p>
                  </div>
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
                onClick={() => removeMedia(file.id)}
              >
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
  )
}
