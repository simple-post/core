import { NextRequest } from "next/server";

import { S3MediaUploader } from "@simple-post/sdk";

import { POST } from "@/app/api/v1/upload/route";
import { apiLogger } from "@/lib/logger";
import { rememberRequestUser } from "@/lib/logger/request-context";

import type { Readable } from "node:stream";

jest.mock("@simple-post/sdk", () => ({
  S3MediaUploader: jest.fn(),
  generateFileKey: () => "user/video.mp4",
  deleteFromStorage: jest.fn(async () => {}),
}));
jest.mock("@/lib/middleware/origin", () => ({ hasAllowedOrigin: () => true }));
jest.mock("@/lib/middleware/auth", () => ({
  requireAuth: async (req: NextRequest) => {
    const user = { id: "user", email: "u@example.com" };
    rememberRequestUser(req, user);
    return { user };
  },
}));
jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findMany: async () => [] } } }));
jest.mock("@/lib/logger", () => ({
  apiLogger: { error: jest.fn(), warn: jest.fn() },
  serializeError: (error: Error) => ({ name: error.name, message: error.message }),
}));

it("preserves MP4 validation errors when storage wraps the stream failure", async () => {
  (S3MediaUploader as jest.Mock).mockImplementation(() => ({
    uploadStream: (stream: Readable) =>
      new Promise((resolve, reject) => {
        stream.on("error", () => reject(new Error("Error uploading file to S3")));
        stream.on("end", () => resolve("https://storage/video.mp4"));
        stream.resume();
      }),
  }));
  const body = new FormData();
  body.set("file", new Blob(["this is not an mp4 video"], { type: "video/mp4" }), "video.mp4");
  const response = await POST(new NextRequest("https://example.com/api/v1/upload", { method: "POST", body }));
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({
    error: "File contents do not match the declared type: video/mp4",
    code: "BAD_REQUEST",
  });
  expect(apiLogger.warn).toHaveBeenCalledWith(
    expect.objectContaining({ userEmail: "u@example.com" }),
    "API request rejected",
  );
  expect(apiLogger.error).not.toHaveBeenCalled();
});
