import type { Platform } from "./post";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  platform: Platform;
  severity: ValidationSeverity;
  code: string;
  message: string;
  field?: "text" | "media" | "image" | "video" | "title" | "description";
  limit?: number;
  actual?: number;
  meta?: Record<string, unknown>;
}

export interface ValidationResult {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  isValid: boolean;
}

export interface PlatformValidationRules {
  text?: {
    maxLength?: number; // text-only posts
    maxCaptionLength?: number; // captions when media is attached
    maxCaptionLengthByMediaType?: {
      image?: number;
      video?: number;
    };
  };
  media?: {
    requiresMedia?: boolean;
    minCount?: number;
    maxCount?: number;
    maxImages?: number;
    maxVideos?: number;
    allowsMixed?: boolean;
  };
  video?: {
    requiresVideo?: boolean;
    maxSizeBytes?: number;
    maxTitleLength?: number;
    maxDescriptionLength?: number;
  };
  image?: {
    maxSizeBytes?: number;
  };
  notes?: string[];
}
