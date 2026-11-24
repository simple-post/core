import { type NextRequest, NextResponse } from "next/server";

import { requireBrowserSession } from "@/lib/middleware/auth";
import { handleApiError } from "@/lib/utils/errors";
import { readFile } from "@/lib/workspaces/files";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }) {
  try {
    const { user } = await requireBrowserSession(req);
    const { id, fileId } = await params;
    const file = await readFile(user, id, fileId);
    const total = file.bytes.byteLength;
    const headers = new Headers({
      "Content-Type": file.mime,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(file.filename),
    });
    const range = req.headers.get("range");
    if (!range) {
      headers.set("Content-Length", String(total));
      return new NextResponse(new Uint8Array(file.bytes), { headers });
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    const start = match?.[1] ? Number(match[1]) : Math.max(0, total - Number(match?.[2]));
    const end = match?.[1] && match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    if (!match || (!match[1] && !match[2]) || start > end || start >= total || !Number.isSafeInteger(start)) {
      headers.set("Content-Range", `bytes */${total}`);
      return new NextResponse(null, { headers, status: 416 });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${total}`);
    headers.set("Content-Length", String(end - start + 1));
    return new NextResponse(new Uint8Array(file.bytes.subarray(start, end + 1)), { headers, status: 206 });
  } catch (error) {
    return handleApiError(error, req);
  }
}
