import { Readable } from "node:stream";

import axios from "axios";
import sharp from "sharp";

import { validatePost } from "@/lib/mcp/tools/validation";
import { prisma } from "@/lib/prisma";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";

jest.mock("axios");
jest.mock("@/lib/prisma", () => ({ prisma: { connectedAccount: { findMany: jest.fn() } } }));
jest.mock("@/lib/security/connected-account-secrets", () => ({ decryptTokenMetadata: () => ({}) }));
jest.mock("@/lib/config", () => ({
  getPlatformById: (id: string) => ({ id, name: id }),
  isSocialPlatformEnabled: () => true,
}));
const media = {
  id: "image",
  type: "image" as const,
  url: "https://drive.google.com/uc?id=private",
  filename: "image.png",
  size: 0,
};
beforeEach(() => {
  jest.clearAllMocks();
  (prisma.connectedAccount.findMany as jest.Mock).mockResolvedValue([
    { id: "instagram", platform: "instagram", username: "test", tokenMetadata: {} },
  ]);
});
function serve(bytes: Buffer, contentType: string) {
  jest.mocked(axios.get).mockResolvedValue({
    status: 200,
    headers: { "content-type": contentType, "content-length": bytes.length },
    data: Readable.from([bytes]),
  });
}
it("returns an actionable error through the MCP validation tool for a Google sign-in page", async () => {
  serve(Buffer.from("<!doctype html><html>Sign in</html>"), "text/html");
  const result = await validatePost("user", { message: "hello", accountIds: ["instagram"], media: [media] });
  expect(result.isValid).toBe(false);
  expect(result.accounts[0].errors).toContainEqual(
    expect.objectContaining({ field: "text.media[0]", message: expect.stringContaining("Upload the file directly") }),
  );
});
it("rejects a real PNG for Instagram in the shared HTTP/app create-update validation boundary", async () => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } })
    .png()
    .toBuffer();
  serve(png, "image/png");
  const result = await validatePostForAccounts({
    userId: "user",
    message: "hello",
    accountIds: ["instagram"],
    media: [media],
  });
  expect(result.summary.isValid).toBe(false);
  expect(result.results[0].errors).toContainEqual(
    expect.objectContaining({ code: "image_format_unsupported", message: expect.stringContaining("JPEG") }),
  );
});
it("accepts actual JPEG bytes through the shared HTTP/app validation boundary", async () => {
  const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: "red" } })
    .jpeg()
    .toBuffer();
  serve(jpeg, "image/jpeg");
  const result = await validatePostForAccounts({
    userId: "user",
    message: "hello",
    accountIds: ["instagram"],
    media: [{ ...media, filename: "image.jpg" }],
  });
  expect(result.summary.isValid).toBe(true);
});
