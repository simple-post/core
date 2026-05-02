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

interface BlueskyRefreshResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

interface BlueskySessionResponse {
  accessJwt: string;
  refreshJwt: string;
  did: string;
  handle?: string;
}

const PROACTIVE_REFRESH_SECONDS = 60;
const DEFAULT_PDS_URL = "https://bsky.social";

type BlueskyAuthMode = "oauth" | "appPassword";

export class BlueskyPublisher extends Publisher {
  static readonly mediaRequirement = "path" as const;

  static getValidationRules(): PlatformValidationRules {
    return VALIDATION_RULES;
  }

  private client: AxiosInstance;
  private authMode: BlueskyAuthMode;
  private accessToken: string;
  private did: string;
  private handle?: string;
  private baseUrl: string;
  private refreshToken?: string;
  private expiresAt: number;
  private tokenUrl?: string;
  private clientId?: string;
  private dpopPublicJwk?: Record<string, unknown>;
  private dpopPrivateJwk?: Record<string, unknown>;
  private dpopNonce?: string;
  private tokenDpopNonce?: string;

  private identifier?: string;
  private appPassword?: string;

  private refreshedCredentials?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  };

  constructor(options?: PostOptionsWithCredentials) {
    super("Bluesky", options);

    if (!options?.bluesky?.credentials) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Bluesky credentials are required in options.bluesky.credentials",
      );
    }

    const credentials = options.bluesky.credentials as Record<string, unknown>;
    const isAppPassword = typeof credentials.identifier === "string" && typeof credentials.appPassword === "string";

    this.authMode = isAppPassword ? "appPassword" : "oauth";

    if (isAppPassword) {
      const { identifier, appPassword, pdsUrl } = credentials as {
        identifier: string;
        appPassword: string;
        pdsUrl?: string;
      };

      this.identifier = identifier;
      this.appPassword = appPassword;
      this.baseUrl = (pdsUrl ?? DEFAULT_PDS_URL).replace(/\/$/, "");
      this.accessToken = "";
      this.did = "";
      this.expiresAt = 0;
    } else {
      const { accessToken, did, pdsUrl, refreshToken, expiresAt, tokenUrl, clientId, dpopPrivateJwk, dpopPublicJwk } =
        credentials as {
          accessToken: string;
          did: string;
          pdsUrl: string;
          refreshToken?: string;
          expiresAt?: number;
          tokenUrl?: string;
          clientId?: string;
          dpopPrivateJwk?: Record<string, unknown>;
          dpopPublicJwk?: Record<string, unknown>;
        };

      if (!pdsUrl) {
        throw new PostError(
          PostErrorType.CREDENTIALS_ERROR,
          "Bluesky pdsUrl is required in options.bluesky.credentials",
        );
      }

      this.accessToken = accessToken;
      this.did = did;
      this.baseUrl = pdsUrl.replace(/\/$/, "");
      this.refreshToken = refreshToken;
      this.expiresAt = expiresAt ?? 0;
      this.tokenUrl = tokenUrl;
      this.clientId = clientId;
      this.dpopPrivateJwk = dpopPrivateJwk;
      this.dpopPublicJwk = dpopPublicJwk;
    }

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
    const iat = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      htu: url,
      htm: method.toUpperCase(),
      jti: crypto.randomUUID(),
      iat,
      exp: iat + 120, // DPoP proof validity window (RFC 9449)
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

  private getTokenExpiry(): number | null {
    const fromRefresh = this.refreshedCredentials?.expiresAt ?? this.expiresAt;
    if (fromRefresh > 0) return fromRefresh;
    const payload = this.decodeJwtPayload(this.accessToken);
    const exp = payload?.exp;
    return typeof exp === "number" ? exp : null;
  }

  private decodeJwtPayload(token: string): Record<string, unknown> | null {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private isTokenExpired(): boolean {
    if (this.authMode === "oauth" && (!this.refreshToken || !this.tokenUrl || !this.clientId)) {
      return false;
    }
    const expiresAt = this.getTokenExpiry();
    if (!expiresAt) return false;
    const now = Math.floor(Date.now() / 1000);
    return now >= expiresAt - PROACTIVE_REFRESH_SECONDS;
  }

  private buildTokenEndpointDpopProof(tokenUrl: string, nonce?: string): string | null {
    if (!this.dpopPrivateJwk || !this.dpopPublicJwk) return null;

    const privateKey = crypto.createPrivateKey({ format: "jwk", key: this.dpopPrivateJwk as JsonWebKey });
    const iat = Math.floor(Date.now() / 1000);
    const payload: Record<string, unknown> = {
      htu: tokenUrl,
      htm: "POST",
      jti: crypto.randomUUID(),
      iat,
      exp: iat + 120,
    };
    if (nonce) payload.nonce = nonce;

    const header = { typ: "dpop+jwt", alg: "ES256", jwk: this.dpopPublicJwk };
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const derSignature = crypto.sign("sha256", Buffer.from(signingInput), privateKey);
    const rawSignature = derToRaw(derSignature);
    return `${signingInput}.${this.base64UrlEncode(rawSignature)}`;
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken || !this.tokenUrl || !this.clientId) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Bluesky access token has expired. Please reconnect your Bluesky account in account settings.",
      );
    }

    const currentRefreshToken = this.refreshedCredentials?.refreshToken ?? this.refreshToken;

    const makeRequest = async (nonce?: string) => {
      const dpopProof = this.buildTokenEndpointDpopProof(this.tokenUrl!, nonce);
      return axios.post<BlueskyRefreshResponse>(
        this.tokenUrl!,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: currentRefreshToken,
          client_id: this.clientId!,
        }),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            ...(dpopProof && { DPoP: dpopProof }),
          },
        },
      );
    };

    try {
      this.logger.info("Refreshing Bluesky access token...");

      let response: Awaited<ReturnType<typeof makeRequest>>;
      try {
        response = await makeRequest(this.tokenDpopNonce);
      } catch (error: unknown) {
        const axiosErr = error as { response?: { status?: number; headers?: Record<string, string> } };
        const nonce =
          axiosErr.response?.status === 401
            ? axiosErr.response?.headers?.["dpop-nonce"] || axiosErr.response?.headers?.["DPoP-Nonce"]
            : undefined;
        if (nonce) {
          this.tokenDpopNonce = nonce;
          response = await makeRequest(nonce);
        } else {
          throw error;
        }
      }
      const { access_token, refresh_token, expires_in } = response.data;
      const expiresAt = expires_in ? Math.floor(Date.now() / 1000) + expires_in : this.expiresAt + 3600;

      this.accessToken = access_token;
      this.refreshedCredentials = {
        accessToken: access_token,
        refreshToken: refresh_token ?? currentRefreshToken,
        expiresAt,
      };
      if (refresh_token) {
        this.refreshToken = refresh_token;
      }
      this.logger.info("Bluesky access token refreshed successfully");
    } catch (error: unknown) {
      const err = error as AxiosErrorLike;
      this.logger.error(`Failed to refresh Bluesky token: ${err.message || error}`);
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Bluesky access token has expired. Please reconnect your Bluesky account in account settings.",
        err.response?.data,
      );
    }
  }

  private async ensureValidToken(): Promise<void> {
    if (this.authMode === "appPassword") {
      if (!this.accessToken) {
        await this.createAppPasswordSession();
        return;
      }
      if (this.isTokenExpired()) {
        try {
          await this.refreshAppPasswordSession();
        } catch (error) {
          this.logger.warn(
            `Bluesky session refresh failed, re-authenticating with app password: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          await this.createAppPasswordSession();
        }
      }
      return;
    }

    if (this.isTokenExpired()) {
      await this.refreshAccessToken();
    }
  }

  private applySessionResponse(data: BlueskySessionResponse): void {
    this.accessToken = data.accessJwt;
    this.refreshToken = data.refreshJwt;
    this.did = data.did;
    if (data.handle) {
      this.handle = data.handle;
    }
    const exp = this.decodeJwtPayload(data.accessJwt)?.exp;
    this.expiresAt = typeof exp === "number" ? exp : Math.floor(Date.now() / 1000) + 3600;
  }

  private async createAppPasswordSession(): Promise<void> {
    if (!this.identifier || !this.appPassword) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "Bluesky app password credentials are missing identifier or appPassword.",
      );
    }

    try {
      this.logger.info("Creating Bluesky session with app password...");
      const response = await this.client.post<BlueskySessionResponse>(
        "/xrpc/com.atproto.server.createSession",
        { identifier: this.identifier, password: this.appPassword },
        { headers: { "Content-Type": "application/json" } },
      );
      this.applySessionResponse(response.data);
      this.logger.info("Bluesky session created successfully");
    } catch (error: unknown) {
      const err = error as AxiosErrorLike;
      this.logger.error(`Failed to create Bluesky session: ${err.message || error}`);
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        `Failed to authenticate with Bluesky app password: ${
          err.response?.data?.message || err.response?.data?.error || err.message || "Unknown error"
        }`,
        err.response?.data,
      );
    }
  }

  private async refreshAppPasswordSession(): Promise<void> {
    if (!this.refreshToken) {
      throw new PostError(PostErrorType.CREDENTIALS_ERROR, "No refresh token available for Bluesky session refresh.");
    }

    this.logger.info("Refreshing Bluesky session...");
    const response = await this.client.post<BlueskySessionResponse>(
      "/xrpc/com.atproto.server.refreshSession",
      undefined,
      { headers: { Authorization: `Bearer ${this.refreshToken}` } },
    );
    this.applySessionResponse(response.data);
    this.logger.info("Bluesky session refreshed successfully");
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

    await this.ensureValidToken();

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

      const result: PostResult = {
        id: response.data.uri || response.data.cid,
        error: PostErrorType.NO_ERROR,
      };
      if (this.refreshedCredentials) {
        result.extraData = {
          refreshedCredentials: {
            accessToken: this.refreshedCredentials.accessToken,
            refreshToken: this.refreshedCredentials.refreshToken,
            expiresAt: this.refreshedCredentials.expiresAt,
          },
        };
      }
      return result;
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
