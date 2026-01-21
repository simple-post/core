import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

// Initialize R2 client
const r2Client = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || "";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || "";

/**
 * Upload a file to Cloudflare R2
 * @param file - The file to upload
 * @param key - The key (path) to store the file at
 * @returns The public URL of the uploaded file
 */
export async function uploadToR2(file: Buffer, key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: file,
    ContentType: contentType,
  });

  await r2Client.send(command);

  // Return the public URL
  return `${R2_PUBLIC_URL}/${key}`;
}

/**
 * Delete a file from Cloudflare R2
 * @param key - The key (path) of the file to delete
 */
export async function deleteFromR2(key: string): Promise<void> {
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });

  await r2Client.send(command);
}

/**
 * Extract the key from an R2 URL
 * @param url - The R2 URL
 * @returns The key (path) in the bucket
 */
export function getKeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Remove leading slash
    return urlObj.pathname.slice(1);
  } catch {
    return null;
  }
}

/**
 * Generate a unique key for a file
 * @param userId - The user ID
 * @param filename - The original filename
 * @returns A unique key for the file
 */
export function generateFileKey(userId: string, filename: string): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).slice(2, 15);
  const ext = filename.split(".").pop();
  return `uploads/${userId}/${timestamp}-${randomStr}.${ext}`;
}
