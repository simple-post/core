import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import path from "node:path";

import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getContentType } from ".";

import { PostError, PostErrorType } from "../types";

import type { Readable } from "node:stream";

const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;

function getStorageConfig(): {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
  endpoint: string | undefined;
  baseUrl: string;
} {
  const accessKeyId = process.env.S3_STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_STORAGE_SECRET_ACCESS_KEY;
  const region = process.env.S3_STORAGE_REGION;
  const bucket = process.env.S3_STORAGE_BUCKET;
  const endpoint = process.env.S3_STORAGE_ENDPOINT;
  const baseUrl = process.env.S3_STORAGE_BASE_URL;

  if (!accessKeyId || !secretAccessKey || !region || !bucket || !baseUrl) {
    throw new PostError(
      PostErrorType.CREDENTIALS_ERROR,
      "S3 configuration is required for media uploads. Set S3_STORAGE_ACCESS_KEY_ID, S3_STORAGE_SECRET_ACCESS_KEY, S3_STORAGE_REGION, S3_STORAGE_BUCKET, and S3_STORAGE_BASE_URL environment variables.",
    );
  }

  return { accessKeyId, secretAccessKey, region, bucket, endpoint, baseUrl: baseUrl.replace(/\/+$/, "") };
}

function createStorageClient(): { client: S3Client; bucket: string; baseUrl: string } {
  const config = getStorageConfig();
  const client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    ...(config.endpoint && { endpoint: config.endpoint }),
  });
  return { client, bucket: config.bucket, baseUrl: config.baseUrl };
}

export class S3MediaUploader {
  private s3Client: S3Client;
  private s3Bucket: string;
  private s3BaseUrl: string;

  constructor() {
    const { client, bucket, baseUrl } = createStorageClient();
    this.s3Client = client;
    this.s3Bucket = bucket;
    this.s3BaseUrl = baseUrl;
  }

  async uploadFile(filePath: string, key: string): Promise<string> {
    return this.uploadStream(createReadStream(filePath), key, getContentType(filePath));
  }

  async uploadStream(
    stream: Readable,
    key: string,
    contentType: string,
    options: { timeoutMs?: number } = {},
  ): Promise<string> {
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.s3Bucket,
          Key: key,
          Body: stream,
          ContentType: contentType,
        },
      });

      const timeoutMs = options.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
      timeout = setTimeout(() => {
        timedOut = true;
        void upload.abort().catch(() => {});
      }, timeoutMs);
      await upload.done();

      return `${this.s3BaseUrl}/${key}`;
    } catch (error: unknown) {
      const err = error as { message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        timedOut
          ? `Timed out uploading file to S3-compatible storage`
          : `Error uploading file to S3: ${err.message || "Unknown error"}`,
        err,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error: unknown) {
      const err = error as { message?: string };
      throw new PostError(
        PostErrorType.API_ERROR,
        `Error deleting file from S3: ${err.message || "Unknown error"}`,
        err,
      );
    }
  }
}

/**
 * Upload a buffer to S3-compatible storage (e.g. Cloudflare R2)
 * @param file - The file buffer to upload
 * @param key - The key (path) to store the file at
 * @param contentType - The MIME type of the file
 * @returns The public URL of the uploaded file
 */
export async function uploadFromBuffer(
  file: Buffer,
  key: string,
  contentType: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  const { client, bucket, baseUrl } = createStorageClient();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file,
    ContentType: contentType,
  });

  const timeoutMs = options.timeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    await client.send(command, { abortSignal: controller.signal });
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new PostError(
        PostErrorType.API_ERROR,
        `Timed out uploading file to S3-compatible storage after ${Math.round(timeoutMs / 1000)} seconds`,
        error,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  return `${baseUrl}/${key}`;
}

/**
 * Generate a presigned URL for uploading a file directly to S3-compatible storage
 * @param key - The key (path) to store the file at
 * @param contentType - The content type of the file
 * @param expiresIn - URL expiration time in seconds (default: 1 hour)
 * @returns The presigned upload URL and the public URL for accessing the file after upload
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600,
  options: { contentLength?: number } = {},
): Promise<{ uploadUrl: string; publicUrl: string }> {
  const { client, bucket, baseUrl } = createStorageClient();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ...(options.contentLength === undefined ? {} : { ContentLength: options.contentLength }),
  });
  const uploadUrl = await (
    getSignedUrl as (client: unknown, command: unknown, options: { expiresIn: number }) => Promise<string>
  )(client, command, { expiresIn });
  const publicUrl = `${baseUrl}/${key}`;
  return { uploadUrl, publicUrl };
}

/**
 * Delete a file from S3-compatible storage
 * @param key - The key (path) of the file to delete
 */
export async function deleteFromStorage(key: string): Promise<void> {
  const { client, bucket } = createStorageClient();
  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });
  await client.send(command);
}

/**
 * Extract the object key from a storage URL
 * @param url - The storage URL (e.g. https://files.example.com/uploads/user/123.jpg)
 * @returns The key (path) in the bucket
 */
export function getKeyFromUrl(url: string, configuredBaseUrl = process.env.S3_STORAGE_BASE_URL): string | null {
  if (!configuredBaseUrl) return null;

  try {
    const schemeIndex = url.indexOf("://");
    const pathIndex = schemeIndex === -1 ? -1 : url.indexOf("/", schemeIndex + 3);
    const rawPath = pathIndex >= 0 ? url.slice(pathIndex).split(/[?#]/, 1)[0] : "/";
    if (
      decodeURIComponent(rawPath)
        .split("/")
        .some((segment) => segment === "." || segment === "..")
    ) {
      return null;
    }

    const urlObj = new URL(url);
    const base = new URL(configuredBaseUrl.endsWith("/") ? configuredBaseUrl : `${configuredBaseUrl}/`);
    if (urlObj.protocol !== base.protocol || urlObj.host !== base.host) return null;

    const basePath = base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`;
    if (!urlObj.pathname.startsWith(basePath)) return null;

    const key = decodeURIComponent(urlObj.pathname.slice(basePath.length));
    if (
      !key ||
      key.startsWith("/") ||
      key.split("/").some((segment) => !segment || segment === "." || segment === "..")
    ) {
      return null;
    }
    return key;
  } catch {
    return null;
  }
}

function storageOwnerSegment(userId: string): string {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(userId) ? userId : createHash("sha256").update(userId).digest("hex").slice(0, 32);
}

/**
 * Extract an object key only when it belongs to the specified user's upload
 * prefix. This prevents cleanup of another user's object when a post contains
 * a storage URL supplied by the caller.
 */
export function getOwnedStorageKeyFromUrl(
  url: string,
  userId: string,
  configuredBaseUrl = process.env.S3_STORAGE_BASE_URL,
): string | null {
  const key = getKeyFromUrl(url, configuredBaseUrl);
  const prefix = `uploads/${storageOwnerSegment(userId)}/`;
  return key?.startsWith(prefix) ? key : null;
}

/**
 * Generate a unique key for a file
 * @param userId - The user ID
 * @param filename - The original filename
 * @returns A unique key for the file
 */
export function generateFileKey(userId: string, filename: string): string {
  const safeUserId = storageOwnerSegment(userId);
  const candidateExtension = path.extname(path.basename(filename)).slice(1).toLowerCase();
  const extension = /^[a-z0-9]{1,8}$/.test(candidateExtension) ? `.${candidateExtension}` : "";
  return `uploads/${safeUserId}/${Date.now()}-${randomUUID()}${extension}`;
}
