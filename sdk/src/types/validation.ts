import type { Platform } from "./post";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  // "common" is used for cross-account / post-level issues (e.g. "thread has
  // no thread-capable accounts"); otherwise this is a Platform.
  platform: Platform | "common";
  severity: ValidationSeverity;
  code: string;
  message: string;
  // Path-style field identifier. Per-platform validators emit "text", "media",
  // etc.; the post-level validator may prefix with a thread index, e.g.
  // "thread[2].text" or "thread".
  field?: string;
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
