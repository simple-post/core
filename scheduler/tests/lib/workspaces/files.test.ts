import { NextRequest } from "next/server";

import { GET } from "@/app/api/v1/workspaces/[id]/files/[fileId]/route";
import { mediaType, readFile } from "@/lib/workspaces/files";
jest.mock("@/lib/middleware/auth", () => ({
  requireBrowserSession: jest.fn(async () => ({ user: { id: "member" } })),
}));
jest.mock("@/lib/workspaces/files", () => ({ ...jest.requireActual("@/lib/workspaces/files"), readFile: jest.fn() }));
const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);
it.each([
  ["bytes=0-1", 206, "bytes 0-1/6", [1, 2]],
  ["bytes=-2", 206, "bytes 4-5/6", [5, 6]],
  ["bytes=1-", 206, "bytes 1-5/6", [2, 3, 4, 5, 6]],
  ["bytes=99-", 416, "bytes */6", []],
] as const)("serves private media range %s", async (range, status, contentRange, body) => {
  jest
    .mocked(readFile)
    .mockResolvedValue({ id: "file", workspaceId: "team", mime: "video/mp4", filename: "clip.mp4", bytes });
  const response = await GET(
    new NextRequest("http://localhost/api/v1/workspaces/team/files/file", { headers: { Range: range } }),
    { params: Promise.resolve({ id: "team", fileId: "file" }) },
  );
  expect(response.status).toBe(status);
  expect(response.headers.get("Content-Range")).toBe(contentRange);
  expect([...new Uint8Array(await response.arrayBuffer())]).toEqual(body);
});
it("distinguishes MP4 from other ISO base media brands", () => {
  const file = (brand: string) =>
    Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftyp" + brand), Buffer.alloc(4)]);
  expect(mediaType(file("mp42"))).toBe("video/mp4");
  for (const brand of ["qt  ", "avif", "heic"]) expect(() => mediaType(file(brand))).toThrow();
});
