import crypto from "node:crypto";
import fs from "node:fs";

import axios from "axios";

import { PostError, PostErrorType } from "../../types";
import { derToRaw, getContentType, hasValidSource, resolveMediaPath, TempFileManager } from "../../utils";
import { Publisher } from "../base";

import type { PostResult } from "../../types";
import type { Content, Image, PostOptionsWithCredentials } from "../../types/post";
import type { PlatformValidationRules, ValidationIssue, ValidationResult } from "../../types/validation";
import type { AxiosInstance } from "axios";

const MAX_TEXT_LENGTH = 300;
const MAX_IMAGES = 4;

type JsonWebKey = Record<string, unknown>;

const VALIDATION_RULES: PlatformValidationRules = {
  text: { maxLength: MAX_TEXT_LENGTH },
  media: { maxCount: MAX_IMAGES, maxImages: MAX_IMAGES, maxVideos: 0, allowsMixed: false },
};

interface UploadBlobResponse {
  blob: {
    $type: string;
    ref: { $link: string };
    mimeType: string;
    size: number;
  };
}

interface AxiosErrorLike {
  response?: {
    status?: number;
    headers?: Record<string, string>;
    data?: { error?: string; message?: string };
  };
  message?: string;
}

export class BlueskyPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private accessToken: string;
  private did: string;
  private baseUrl: string;
  private dpopPublicJwk?: Record<string, unknown>;
  private dpopPrivateJwk?: Record<string, unknown>;
  private dpopNonce?: string;

  constructor(options?: PostOptionsWithCredentials) {
    super("Bluesky", options);

    if (!options?.bluesky?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Bluesky credentials are required in options.bluesky.credentials",
      );
    }

    const { accessToken, did, pdsUrl, dpopPrivateJwk, dpopPublicJwk } = options.bluesky.credentials;

    if (!pdsUrl) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "Bluesky pdsUrl is required in options.bluesky.credentials");
    }

    this.accessToken = accessToken;
    this.did = did;
    this.baseUrl = pdsUrl.replace(/\/$/, "");
    this.dpopPrivateJwk = dpopPrivateJwk;
    this.dpopPublicJwk = dpopPublicJwk;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30_000,
    });
  }

  private base64UrlEncode(input: string | Buffer): string {
    return Buffer.from(input).toString("base64url");
  }

  private buildDpopProof(method: string, path: string, nonce?: string): string | null {
    if (!this.dpopPrivateJwk || !this.dpopPublicJwk) {
      return null;
    }

    const privateKey = crypto.createPrivateKey({ format: "jwk", key: this.dpopPrivateJwk as JsonWebKey });
    const url = new URL(path, this.baseUrl).toString();

    const header = {
      typ: "dpop+jwt",
      alg: "ES256",
      jwk: this.dpopPublicJwk,
    };
    const payload: Record<string, unknown> = {
      htu: url,
      htm: method.toUpperCase(),
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
    };

    // Add access token hash for resource server requests
    const ath = crypto.createHash("sha256").update(this.accessToken).digest("base64url");
    payload.ath = ath;

    if (nonce) {
      payload.nonce = nonce;
    }

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // Sign with ECDSA SHA-256 (ES256)
    const derSignature = crypto.sign("sha256", Buffer.from(signingInput), privateKey);

    // Convert DER signature to raw R||S format required by JWS
    const rawSignature = derToRaw(derSignature);

    return `${signingInput}.${this.base64UrlEncode(rawSignature)}`;
  }

  private buildAuthHeaders(method: string, path: string, nonce?: string): Record<string, string> {
    const headers: Record<string, string> = {};
    const tokenType = this.dpopPrivateJwk && this.dpopPublicJwk ? "DPoP" : "Bearer";
    headers.Authorization = `${tokenType} ${this.accessToken}`;

    const dpopProof = this.buildDpopProof(method, path, nonce);
    if (dpopProof) {
      headers.DPoP = dpopProof;
    }

    return headers;
  }

  private isNonceError(error: unknown): error is AxiosErrorLike {
    const err = error as AxiosErrorLike;
    return err.response?.data?.error === "use_dpop_nonce";
  }

  private extractNonce(error: AxiosErrorLike): string | undefined {
    // The nonce comes in the DPoP-Nonce header (case-insensitive)
    const headers = error.response?.headers;
    if (!headers) return undefined;

    // Headers might be lowercase
    return headers["dpop-nonce"] || headers["DPoP-Nonce"];
  }

  private async uploadImage(_image: Image, resolvedPath: string): Promise<UploadBlobResponse["blob"]> {
    if (!fs.existsSync(resolvedPath)) {
      throw new PostError(PostErrorType.INVALID_CONTENT, `Media file not found: ${resolvedPath}`);
    }

    const fileBuffer = fs.readFileSync(resolvedPath);
    const path = "/xrpc/com.atproto.repo.uploadBlob";

    const makeRequest = async (nonce?: string) => {
      return this.client.post<UploadBlobResponse>(path, fileBuffer, {
        headers: {
          "Content-Type": getContentType(resolvedPath),
          ...this.buildAuthHeaders("POST", path, nonce),
        },
      });
    };

    try {
      // Try with existing nonce first
      const response = await makeRequest(this.dpopNonce);
      return response.data.blob;
    } catch (error: unknown) {
      // If nonce error, extract nonce and retry
      if (this.isNonceError(error)) {
        const nonce = this.extractNonce(error);
        if (nonce) {
          this.dpopNonce = nonce;
          try {
            const response = await makeRequest(nonce);
            return response.data.blob;
          } catch (retryError: unknown) {
            const err = retryError as AxiosErrorLike;
            this.logger.error(retryError instanceof Error ? retryError : String(retryError));
            throw new PostError(
              PostErrorType.API_ERROR,
              `Failed to upload Bluesky image: ${err.response?.data?.message || err.message || "Unknown error"}`,
              err.response?.data,
            );
          }
        }
      }

      const err = error as AxiosErrorLike;
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to upload Bluesky image: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    }
  }

  static validate(content: Content): ValidationResult {
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const text = content.text ?? "";
    const media = content.media ?? [];
    const mediaCount = media.length;

    let images = 0;
    let videos = 0;
    for (const item of media) {
      if (item.type === "image") images += 1;
      if (item.type === "video") videos += 1;
    }

    if (!text.trim() && mediaCount === 0) {
      errors.push({
        platform: "bluesky",
        severity: "error",
        code: "content_required",
        message: "Bluesky posts require text or images.",
        field: "text",
      });
    }

    if (text.length > MAX_TEXT_LENGTH) {
      errors.push({
        platform: "bluesky",
        severity: "error",
        code: "text_too_long",
        message: `Bluesky text cannot exceed ${MAX_TEXT_LENGTH} characters.`,
        field: "text",
        limit: MAX_TEXT_LENGTH,
        actual: text.length,
      });
    }

    for (const item of media) {
      if (!hasValidSource(item)) {
        errors.push({
          platform: "bluesky",
          severity: "error",
          code: "media_source_missing",
          message: "Media must have either a path or url.",
          field: "media",
        });
        break;
      }
    }

    if (videos > 0) {
      errors.push({
        platform: "bluesky",
        severity: "error",
        code: "video_not_supported",
        message: "Bluesky publisher currently supports images only.",
        field: "media",
      });
    }

    if (images > MAX_IMAGES) {
      warnings.push({
        platform: "bluesky",
        severity: "warning",
        code: "too_many_images",
        message: `Bluesky supports up to ${MAX_IMAGES} images. Only the first ${MAX_IMAGES} will be posted.`,
        field: "media",
        limit: MAX_IMAGES,
        actual: images,
      });
    }

    return { errors, warnings, isValid: errors.length === 0 };
  }

  async postContent(content: Content, _options?: PostOptionsWithCredentials): Promise<PostResult> {
    const validation = BlueskyPublisher.validate(content);
    if (!validation.isValid) {
      throw new PostError(PostErrorType.INVALID_CONTENT, "Bluesky content validation failed", validation);
    }
    for (const warning of validation.warnings) {
      this.logger.warn(warning.message);
    }

    const tempFileManager = new TempFileManager();

    try {
      const images = (content.media ?? []).filter((item): item is Image => item.type === "image").slice(0, MAX_IMAGES);
      let embed: Record<string, unknown> | undefined;

      if (images.length > 0) {
        const uploadedImages = [];
        for (const image of images) {
          const { path: resolvedPath, cleanup } = await resolveMediaPath(image);
          tempFileManager.add(cleanup);

          const blob = await this.uploadImage(image, resolvedPath);
          uploadedImages.push({
            image: blob,
            alt: image.caption ?? "",
          });
        }

        embed = {
          $type: "app.bsky.embed.images",
          images: uploadedImages,
        };
      }

      const record = {
        $type: "app.bsky.feed.post",
        text: content.text ?? "",
        createdAt: new Date().toISOString(),
        ...(embed ? { embed } : {}),
      };

      const path = "/xrpc/com.atproto.repo.createRecord";
      const body = {
        repo: this.did,
        collection: "app.bsky.feed.post",
        record,
      };

      const makeRequest = async (nonce?: string) => {
        return this.client.post(path, body, {
          headers: {
            ...this.buildAuthHeaders("POST", path, nonce),
          },
        });
      };

      let response;
      try {
        // Try with existing nonce first
        response = await makeRequest(this.dpopNonce);
      } catch (error: unknown) {
        // If nonce error, extract nonce and retry
        if (this.isNonceError(error)) {
          const nonce = this.extractNonce(error);
          if (nonce) {
            this.dpopNonce = nonce;
            response = await makeRequest(nonce);
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }

      return {
        id: response.data.uri || response.data.cid,
        error: PostErrorType.NO_ERROR,
      };
    } catch (error: unknown) {
      const err = error as AxiosErrorLike;
      this.logger.error(error instanceof Error ? error : String(error));
      throw new PostError(
        PostErrorType.API_ERROR,
        `Failed to post to Bluesky: ${err.response?.data?.message || err.message || "Unknown error"}`,
        err.response?.data,
      );
    } finally {
      await tempFileManager.cleanup();
    }
  }
}
