import { mediaHeaderMatchesContentType } from "../src/media-types";
import { generateFileKey, getKeyFromUrl, getOwnedStorageKeyFromUrl } from "../src/utils/s3";

describe("S3 utility safety", () => {
  it("only extracts keys owned by the configured public storage base URL", () => {
    const baseUrl = "https://files.example.com/public";

    expect(getKeyFromUrl("https://files.example.com/public/uploads/user/file.jpg", baseUrl)).toBe(
      "uploads/user/file.jpg",
    );
    expect(getKeyFromUrl("https://other.example.com/public/uploads/user/file.jpg", baseUrl)).toBeNull();
    expect(getKeyFromUrl("https://files.example.com/other/file.jpg", baseUrl)).toBeNull();
    expect(getKeyFromUrl("https://files.example.com/public/uploads/../secret", baseUrl)).toBeNull();
  });

  it("generates keys without preserving path traversal or unsafe extensions", () => {
    const key = generateFileKey("../../user", "../../photo.JPG");
    expect(key).toMatch(/^uploads\/[a-f0-9]{32}\/\d+-[a-f0-9-]+\.jpg$/);
    expect(key).not.toContain("..");

    const unsafeExtension = generateFileKey("user-1", "file.really-long-extension");
    expect(unsafeExtension).toMatch(/^uploads\/user-1\/\d+-[a-f0-9-]+$/);
  });

  it("only extracts keys from the expected user's upload prefix", () => {
    const baseUrl = "https://files.example.com/public";

    expect(getOwnedStorageKeyFromUrl(`${baseUrl}/uploads/user-a/file.jpg`, "user-a", baseUrl)).toBe(
      "uploads/user-a/file.jpg",
    );
    expect(getOwnedStorageKeyFromUrl(`${baseUrl}/uploads/user-b/file.jpg`, "user-a", baseUrl)).toBeNull();
  });
});

describe("mediaHeaderMatchesContentType", () => {
  it.each([
    ["image/jpeg", [255, 216, 255, 0]],
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/gif", [...Buffer.from("GIF89a")]],
    ["image/webp", [...Buffer.from("RIFF0000WEBP")]],
    ["video/mp4", [0, 0, 0, 16, ...Buffer.from("ftyp")]],
    ["video/webm", [26, 69, 223, 163]],
  ])("recognizes %s", (contentType, bytes) => {
    expect(mediaHeaderMatchesContentType(Uint8Array.from(bytes as number[]), contentType as string)).toBe(true);
  });

  it("rejects bytes that do not match the declared type", () => {
    expect(mediaHeaderMatchesContentType(Uint8Array.from(Buffer.from("<html>")), "image/png")).toBe(false);
  });
});
