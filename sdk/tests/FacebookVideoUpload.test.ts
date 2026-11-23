import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";

import { FacebookVideoUpload } from "../src/publishers/facebook/video-upload";
import { PostErrorType } from "../src/types";

import type { AxiosInstance } from "axios";
import type FormData from "form-data";

let directory: string;
let filePath: string;
let post: jest.Mock;
let get: jest.Mock;
let uploader: FacebookVideoUpload;
const url = "https://files.example/uploads/test/video.mp4";
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "facebook-video-unit-"));
  filePath = path.join(directory, "video.mp4");
  fs.writeFileSync(filePath, Buffer.alloc(10));
  post = jest.fn();
  get = jest.fn().mockResolvedValue({ data: { status: { video_status: "ready" } } });
  uploader = new FacebookVideoUpload({ post, get } as unknown as AxiosInstance, "page", "SECRET", () => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  fs.rmSync(directory, { recursive: true, force: true });
});

it("streams a 130 MiB file in exact server-selected ranges with a matching SHA-256", async () => {
  const blockSize = 1024 * 1024;
  const size = 130 * blockSize + 13;
  const expected = createHash("sha256");
  const fd = fs.openSync(filePath, "w");
  try {
    for (let offset = 0; offset < size; offset += blockSize) {
      const block = Buffer.alloc(Math.min(blockSize, size - offset), offset / blockSize);
      fs.writeSync(fd, block);
      expected.update(block);
    }
  } finally {
    fs.closeSync(fd);
  }
  const received = createHash("sha256");
  let offset = 0;
  let transfers = 0;
  let largestBody = 0;
  const end = () => Math.min(size, offset + 4 * blockSize + transfers * 17);
  post.mockImplementation(async (_url: string, body: URLSearchParams | FormData) => {
    if (body instanceof URLSearchParams) {
      if (body.get("upload_phase") === "start") {
        expect(body.get("file_size")).toBe(String(size));
        return {
          data: { video_id: "video", upload_session_id: "session", start_offset: "0", end_offset: String(end()) },
        };
      }
      expect(body.get("upload_phase")).toBe("finish");
      expect(offset).toBe(size);
      return { data: { success: true } };
    }
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const sink = new Writable({
        write(chunk, _encoding, done) {
          chunks.push(Buffer.from(chunk));
          done();
        },
      });
      sink.on("finish", resolve).on("error", reject);
      body.on("error", reject).pipe(sink);
    });
    const multipart = Buffer.concat(chunks);
    largestBody = Math.max(largestBody, multipart.length);
    const fileHeader = multipart.indexOf('name="video_file_chunk"');
    expect(fileHeader).toBeGreaterThan(0);
    const start = multipart.indexOf("\r\n\r\n", fileHeader) + 4;
    const finish = multipart.lastIndexOf(`\r\n--${body.getBoundary()}--`);
    const bytes = multipart.subarray(start, finish);
    expect(bytes.length).toBe(end() - offset);
    received.update(bytes);
    offset += bytes.length;
    transfers++;
    return { data: { start_offset: String(offset), end_offset: String(end()) } };
  });
  expect(await uploader.publish({ filePath })).toBe("video");
  expect(received.digest("hex")).toBe(expected.digest("hex"));
  expect(transfers).toBeGreaterThan(30);
  expect(largestBody).toBeLessThan(5 * blockSize);
}, 30_000);

it("bounds total transfer time and never sends finish after the upload deadline", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  post.mockImplementationOnce(async () => {
    clock.mockReturnValue(now + 10 * 60_000);
    return { data: { video_id: "video", upload_session_id: "session", start_offset: "0", end_offset: "10" } };
  });
  await expect(uploader.publish({ filePath })).rejects.toMatchObject({ errorType: PostErrorType.PUBLISH_REJECTED });
  expect(post).toHaveBeenCalledTimes(1);
});
function start() {
  post.mockResolvedValueOnce({
    data: { video_id: "video", upload_session_id: "session", start_offset: "0", end_offset: "10" },
  });
}

it("sends only the URL and metadata, and waits for processing without resubmitting", async () => {
  jest.useFakeTimers();
  post.mockResolvedValueOnce({ data: { id: "video" } });
  get.mockResolvedValueOnce({ data: { status: { video_status: "processing" } } });
  const result = uploader.publish({ filePath, fileUrl: url, title: "Title", description: "Caption" });
  await jest.runAllTimersAsync();
  expect(await result).toBe("video");
  const params = post.mock.calls[0][1] as URLSearchParams;
  expect(Object.fromEntries(params)).toEqual({
    file_url: url,
    title: "Title",
    description: "Caption",
    access_token: "SECRET",
  });
  expect(post).toHaveBeenCalledTimes(1);
  expect(get).toHaveBeenCalledTimes(2);
});

it.each(["url", "finish"])("preserves a definite 413 rejection from %s without leaking the request", async (phase) => {
  if (phase === "finish") {
    start();
    post.mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "10" } });
  }
  post.mockRejectedValueOnce({
    message: "access_token=SECRET",
    config: { data: "SECRET" },
    response: { status: 413, data: "" },
  });
  const error = await uploader
    .publish({ filePath, ...(phase === "url" && { fileUrl: url }) })
    .catch((error: unknown) => error);
  expect(error).toMatchObject({
    errorType: PostErrorType.PUBLISH_REJECTED,
    details: { stage: phase, httpStatus: 413 },
  });
  expect(JSON.stringify(error)).not.toContain("SECRET");
  expect(get).not.toHaveBeenCalled();
});

it.each(["url", "finish"])("does not permit a duplicate after an ambiguous %s timeout", async (phase) => {
  if (phase === "finish") {
    start();
    post.mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "10" } });
  }
  post.mockRejectedValueOnce(new Error("socket timeout SECRET"));
  await expect(uploader.publish({ filePath, ...(phase === "url" && { fileUrl: url }) })).rejects.toMatchObject({
    errorType: PostErrorType.API_ERROR,
    details: { stage: phase, ...(phase === "finish" && { videoId: "video" }) },
  });
  expect(post).toHaveBeenCalledTimes(phase === "url" ? 1 : 3);
});

it("keeps a transfer failure safely retryable and never finishes the upload", async () => {
  start();
  post.mockRejectedValueOnce(new Error("connection lost"));
  await expect(uploader.publish({ filePath })).rejects.toMatchObject({
    errorType: PostErrorType.PUBLISH_REJECTED,
    details: { stage: "transfer", videoId: "video" },
  });
  expect(post).toHaveBeenCalledTimes(2);
});

it.each([
  { start_offset: "0", end_offset: "0" },
  { start_offset: "-1", end_offset: "2" },
  { start_offset: "0", end_offset: "11" },
  { start_offset: "0", end_offset: "NaN" },
])("refuses invalid server offsets %j before sending bytes", async (offsets) => {
  post.mockResolvedValueOnce({ data: { video_id: "video", upload_session_id: "session", ...offsets } });
  await expect(uploader.publish({ filePath })).rejects.toMatchObject({ errorType: PostErrorType.PREPARATION_ERROR });
  expect(post).toHaveBeenCalledTimes(1);
});

it("refuses nonadvancing offsets instead of looping or publishing a partial video", async () => {
  start();
  post.mockResolvedValueOnce({ data: { start_offset: "0", end_offset: "10" } });
  await expect(uploader.publish({ filePath })).rejects.toMatchObject({ errorType: PostErrorType.PREPARATION_ERROR });
  expect(post).toHaveBeenCalledTimes(2);
});

it.each(["error", "unexpected", undefined])("retains the video ID when processing returns %s", async (status) => {
  post.mockResolvedValueOnce({ data: { id: "video" } });
  get.mockResolvedValueOnce({ data: { status: { video_status: status } } });
  await expect(uploader.publish({ filePath, fileUrl: url })).rejects.toMatchObject({
    errorType: PostErrorType.API_ERROR,
    details: { stage: "processing", videoId: "video" },
  });
  expect(post).toHaveBeenCalledTimes(1);
});

it("bounds processing waits and preserves the accepted ID for reconciliation", async () => {
  jest.useFakeTimers();
  post.mockResolvedValueOnce({ data: { id: "video" } });
  get.mockResolvedValue({ data: { status: { video_status: "processing" } } });
  const result = uploader.publish({ filePath, fileUrl: url }).catch((error: unknown) => error);
  await jest.runAllTimersAsync();
  expect(await result).toMatchObject({
    errorType: PostErrorType.API_ERROR,
    details: { videoId: "video", stage: "processing" },
  });
  expect(get.mock.calls.length).toBeLessThanOrEqual(60);
  expect(post).toHaveBeenCalledTimes(1);
});

describe("bounded preparation recovery", () => {
  const finishCalls = (): URLSearchParams[] =>
    post.mock.calls
      .map(([, body]: [string, URLSearchParams | FormData]) => body)
      .filter(
        (body): body is URLSearchParams => body instanceof URLSearchParams && body.get("upload_phase") === "finish",
      );
  let streams: fs.ReadStream[];
  beforeEach(() => {
    jest.useFakeTimers();
    streams = [];
    const original = fs.createReadStream;
    jest.spyOn(fs, "createReadStream").mockImplementation((...args) => {
      const stream = original(...args);
      streams.push(stream);
      return stream;
    });
  });

  it("resends a chunk Meta explicitly rejected as transient on the same session and offset", async () => {
    start();
    post
      .mockRejectedValueOnce({ response: { status: 400, data: { error: { code: 2, is_transient: true } } } })
      .mockRejectedValueOnce({ response: { status: 500, data: { error: { code: 1, is_transient: true } } } })
      .mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "10" } })
      .mockResolvedValueOnce({ data: { success: true } });
    const result = uploader.publish({ filePath });
    await jest.runAllTimersAsync();
    expect(await result).toBe("video");
    expect(post).toHaveBeenCalledTimes(5);
    expect(streams).toHaveLength(3);
    expect(streams.every((stream) => stream.destroyed)).toBe(true);
    for (const [, options] of jest.mocked(fs.createReadStream).mock.calls) {
      expect(options).toEqual({ start: 0, end: 9 });
    }
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0].get("upload_session_id")).toBe("session");
  });

  it("restarts only the preparation session after an ambiguous later-chunk failure", async () => {
    fs.writeFileSync(filePath, Buffer.alloc(20));
    post
      .mockResolvedValueOnce({
        data: { video_id: "video", upload_session_id: "session", start_offset: "0", end_offset: "10" },
      })
      .mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "20" } })
      .mockRejectedValueOnce({ code: "ECONNRESET", message: "socket hang up" })
      .mockResolvedValueOnce({
        data: { video_id: "video-2", upload_session_id: "session-2", start_offset: "0", end_offset: "10" },
      })
      .mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "20" } })
      .mockResolvedValueOnce({ data: { start_offset: "20", end_offset: "20" } })
      .mockResolvedValueOnce({ data: { success: true } });
    const result = uploader.publish({ filePath });
    await jest.runAllTimersAsync();
    expect(await result).toBe("video-2");
    expect(post).toHaveBeenCalledTimes(7);
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0].get("upload_session_id")).toBe("session-2");
    expect(streams.every((stream) => stream.destroyed)).toBe(true);
  });

  it("gives up after bounded chunk attempts without ever finishing", async () => {
    start();
    post.mockRejectedValue({ response: { status: 400, data: { error: { code: 2, is_transient: true } } } });
    const result = uploader.publish({ filePath }).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await result).toMatchObject({
      errorType: PostErrorType.PUBLISH_REJECTED,
      details: { stage: "transfer", videoId: "video", httpStatus: 400, code: 2 },
    });
    expect(post).toHaveBeenCalledTimes(4);
    expect(finishCalls()).toHaveLength(0);
  });

  it("treats a bare proxy 502 after an accepted chunk as ambiguous and starts a fresh session", async () => {
    fs.writeFileSync(filePath, Buffer.alloc(20));
    post
      .mockResolvedValueOnce({
        data: { video_id: "video", upload_session_id: "session", start_offset: "0", end_offset: "10" },
      })
      .mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "20" } })
      .mockRejectedValueOnce({ response: { status: 502, data: "<html>Bad Gateway</html>" } })
      .mockResolvedValueOnce({
        data: { video_id: "video-2", upload_session_id: "session-2", start_offset: "0", end_offset: "10" },
      })
      .mockResolvedValueOnce({ data: { start_offset: "10", end_offset: "20" } })
      .mockResolvedValueOnce({ data: { start_offset: "20", end_offset: "20" } })
      .mockResolvedValueOnce({ data: { success: true } });
    const result = uploader.publish({ filePath });
    await jest.runAllTimersAsync();
    expect(await result).toBe("video-2");
    // The call after the 502 is a new start phase, not a resend of offset 10 on the old session.
    const afterFailure = post.mock.calls[3][1] as URLSearchParams;
    expect(afterFailure).toBeInstanceOf(URLSearchParams);
    expect(afterFailure.get("upload_phase")).toBe("start");
    expect(post).toHaveBeenCalledTimes(7);
    expect(finishCalls()).toHaveLength(1);
    expect(finishCalls()[0].get("upload_session_id")).toBe("session-2");
  });

  it("stops after three preparation sessions when every later chunk fails ambiguously", async () => {
    fs.writeFileSync(filePath, Buffer.alloc(20));
    let sessions = 0;
    post.mockImplementation(async (_url: string, body: URLSearchParams | FormData) => {
      if (body instanceof URLSearchParams) {
        expect(body.get("upload_phase")).toBe("start");
        sessions++;
        return {
          data: {
            video_id: `video-${sessions}`,
            upload_session_id: `s${sessions}`,
            start_offset: "0",
            end_offset: "10",
          },
        };
      }
      if (post.mock.calls.length % 3 === 2) return { data: { start_offset: "10", end_offset: "20" } };
      throw { response: { status: 503, data: "" } };
    });
    const result = uploader.publish({ filePath }).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await result).toMatchObject({
      errorType: PostErrorType.PUBLISH_REJECTED,
      details: { stage: "transfer", videoId: "video-3", httpStatus: 503 },
    });
    expect(sessions).toBe(3);
    expect(finishCalls()).toHaveLength(0);
  });

  it.each([400, 413])("does not retry a definite HTTP %i chunk rejection", async (status) => {
    start();
    post.mockRejectedValueOnce({ response: { status, data: { error: { code: 100 } } } });
    const result = uploader.publish({ filePath }).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await result).toMatchObject({ errorType: PostErrorType.PUBLISH_REJECTED, details: { stage: "transfer" } });
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("retries a transient status read for the same accepted video", async () => {
    post.mockResolvedValueOnce({ data: { id: "video" } });
    get.mockRejectedValueOnce({ response: { status: 503 } });
    const result = uploader.publish({ filePath, fileUrl: url });
    await jest.runAllTimersAsync();
    expect(await result).toBe("video");
    expect(post).toHaveBeenCalledTimes(1);
    expect(get.mock.calls.map(([route]) => route)).toEqual(["/video", "/video"]);
  });

  it("keeps exhausted status reads as an uncertain outcome with the video ID", async () => {
    post.mockResolvedValueOnce({ data: { id: "video" } });
    get.mockRejectedValue({ response: { status: 503 } });
    const result = uploader.publish({ filePath, fileUrl: url }).catch((error: unknown) => error);
    await jest.runAllTimersAsync();
    expect(await result).toMatchObject({
      errorType: PostErrorType.API_ERROR,
      details: { stage: "processing", videoId: "video", httpStatus: 503 },
    });
    expect(get).toHaveBeenCalledTimes(3);
    expect(post).toHaveBeenCalledTimes(1);
  });
});

it("does not turn a status-read credential failure into a safe retry", async () => {
  post.mockResolvedValueOnce({ data: { id: "video" } });
  get.mockRejectedValueOnce({ response: { status: 401, data: { error: { code: 190 } } } });
  await expect(uploader.publish({ filePath, fileUrl: url })).rejects.toMatchObject({
    errorType: PostErrorType.API_ERROR,
    details: { videoId: "video", httpStatus: 401 },
  });
});
