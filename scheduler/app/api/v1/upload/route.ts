import { Readable, Transform } from "node:stream";

import { type NextRequest, NextResponse } from "next/server";

import { deleteFromStorage, generateFileKey, S3MediaUploader } from "@simple-post/sdk";
import { ALLOWED_MEDIA_TYPES, mediaHeaderMatchesContentType, normalizeContentType } from "@simple-post/sdk/media-types";
import Busboy from "busboy";

import { requireAuth } from "@/lib/middleware/auth";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const MAX_FILE_SIZE = 500 * 1024 * 1024;
const STORAGE_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

interface StreamedUpload {
  filename: string;
  key: string;
  size: number;
  type: string;
  url: string;
}

class MediaSignatureTransform extends Transform {
  private readonly chunks: Buffer[] = [];
  private bufferedBytes = 0;
  private checked = false;

  constructor(private readonly contentType: string) {
    super();
  }

  private checkAndFlush(callback: (error?: Error | null) => void): void {
    const buffered = Buffer.concat(this.chunks, this.bufferedBytes);
    if (!mediaHeaderMatchesContentType(buffered, this.contentType)) {
      callback(new BadRequestError(`File contents do not match the declared type: ${this.contentType}`));
      return;
    }

    this.checked = true;
    this.chunks.length = 0;
    this.bufferedBytes = 0;
    this.push(buffered);
    callback();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.checked) {
      this.push(chunk);
      callback();
      return;
    }

    this.chunks.push(chunk);
    this.bufferedBytes += chunk.length;
    if (this.bufferedBytes >= 16) {
      this.checkAndFlush(callback);
      return;
    }
    callback();
  }

  override _flush(callback: (error?: Error | null) => void): void {
    if (this.checked) {
      callback();
      return;
    }
    this.checkAndFlush(callback);
  }
}

async function streamMultipartUpload(req: NextRequest, userId: string): Promise<StreamedUpload> {
  const contentType = req.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    throw new BadRequestError("Content-Type must be multipart/form-data");
  }
  if (!req.body) {
    throw new BadRequestError("No file provided");
  }

  const uploader = new S3MediaUploader();
  let keyForCleanup: string | undefined;

  try {
    return await new Promise<StreamedUpload>((resolve, reject) => {
      const parser = Busboy({
        headers: { "content-type": contentType },
        limits: {
          fileSize: MAX_FILE_SIZE,
          files: 1,
          fields: 0,
          // Busboy emits partsLimit when this threshold is reached. Using 2
          // lets the one valid file part through and treats a second part as
          // the limit violation; files/fields still enforce the exact shape.
          parts: 2,
          headerPairs: 200,
        },
      });

      let fileSeen = false;
      let fileTooLarge = false;
      let failure: Error | undefined;
      let uploadPromise: Promise<string> | undefined;
      let filename = "";
      let resolvedType = "";
      let size = 0;

      parser.on("file", (fieldName, stream, info) => {
        if (fileSeen || fieldName !== "file") {
          failure ??= new BadRequestError("Expected one multipart file field named 'file'");
          stream.resume();
          return;
        }
        fileSeen = true;
        filename = info.filename || "upload";
        resolvedType = normalizeContentType(info.mimeType, filename) ?? "";
        if (!resolvedType || !ALLOWED_MEDIA_TYPES.has(resolvedType)) {
          failure = new BadRequestError(`Invalid file type: ${info.mimeType || "(unknown)"}`);
          stream.resume();
          return;
        }

        keyForCleanup = generateFileKey(userId, filename);
        const verifiedStream = new MediaSignatureTransform(resolvedType);
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
        });
        stream.on("limit", () => {
          fileTooLarge = true;
        });
        verifiedStream.on("error", (error) => {
          failure ??= error;
          stream.resume();
        });
        stream.pipe(verifiedStream);
        uploadPromise = uploader.uploadStream(verifiedStream, keyForCleanup, resolvedType, {
          timeoutMs: STORAGE_UPLOAD_TIMEOUT_MS,
        });
      });

      parser.on("filesLimit", () => {
        failure ??= new BadRequestError("Only one file may be uploaded");
      });
      parser.on("fieldsLimit", () => {
        failure ??= new BadRequestError("Multipart form fields are not accepted");
      });
      parser.on("partsLimit", () => {
        failure ??= new BadRequestError("Multipart request contains too many parts");
      });
      parser.on("error", reject);
      parser.on("finish", () => {
        void (async () => {
          if (!fileSeen || !uploadPromise || !keyForCleanup) {
            throw failure ?? new BadRequestError("No file provided");
          }

          const url = await uploadPromise;
          if (fileTooLarge) {
            throw new BadRequestError(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
          }
          if (failure) throw failure;

          resolve({ url, key: keyForCleanup, filename, size, type: resolvedType });
        })().catch(reject);
      });

      const body = Readable.fromWeb(req.body as unknown as NodeReadableStream);
      body.on("error", reject);
      body.pipe(parser);
    });
  } catch (error) {
    if (keyForCleanup) {
      await deleteFromStorage(keyForCleanup).catch(() => {});
    }
    throw error;
  }
}

// Streaming multipart fallback for clients that cannot PUT to the presigned
// object-storage URL. The request is never materialized as a 500 MB Buffer.
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth(req);
    return NextResponse.json(await streamMultipartUpload(req, session.user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
