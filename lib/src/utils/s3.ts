import { createReadStream } from "node:fs";

import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

import { getContentType } from ".";

import { PostError, PostErrorType } from "../types";

export class S3MediaUploader {
  private s3Client: S3Client;
  private s3Bucket: string;
  private s3BaseUrl: string;

  constructor() {
    // Validate the S3 configuration for temporary media storage
    const s3AccessKeyId = process.env.S3_STORAGE_ACCESS_KEY_ID;
    const s3SecretAccessKey = process.env.S3_STORAGE_SECRET_ACCESS_KEY;
    const s3Region = process.env.S3_STORAGE_REGION;
    const s3Bucket = process.env.S3_STORAGE_BUCKET;
    const s3Endpoint = process.env.S3_STORAGE_ENDPOINT;
    const s3BaseUrl = process.env.S3_STORAGE_BASE_URL;

    if (!s3AccessKeyId || !s3SecretAccessKey || !s3Region || !s3Bucket || !s3BaseUrl) {
      throw new PostError(
        PostErrorType.CREDENTIALS_ERROR,
        "S3 configuration is required for Instagram uploads. Set S3_STORAGE_ACCESS_KEY_ID, S3_STORAGE_SECRET_ACCESS_KEY, S3_STORAGE_REGION, S3_STORAGE_BUCKET, and S3_STORAGE_BASE_URL environment variables.",
      );
    }

    this.s3Bucket = s3Bucket;
    this.s3BaseUrl = s3BaseUrl;

    // Create S3 client
    this.s3Client = new S3Client({
      region: s3Region,
      credentials: {
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
      },
      ...(s3Endpoint && { endpoint: s3Endpoint }),
    });
  }

  async uploadFile(filePath: string, key: string): Promise<string> {
    try {
      const fileStream = createReadStream(filePath);

      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.s3Bucket,
          Key: key,
          Body: fileStream,
          ACL: "public-read",
          ContentType: getContentType(filePath),
        },
      });

      await upload.done();

      return `${this.s3BaseUrl}/${key}`;
    } catch (error: any) {
      throw new PostError(PostErrorType.API_ERROR, `Error uploading file to S3: ${error.message}`, error);
    }
  }

  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      await this.s3Client.send(command);
    } catch (error: any) {
      throw new PostError(PostErrorType.API_ERROR, `Error deleting file from S3: ${error.message}`, error);
    }
  }
}
