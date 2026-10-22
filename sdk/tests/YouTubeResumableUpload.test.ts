import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import axios from "axios";

import {
  isTrustedSessionUrl,
  parseAcknowledgedBytes,
  parseRetryAfterMs,
  uploadYouTubeVideo,
} from "../src/publishers/youtube/resumable-upload";
import { PostErrorType } from "../src/types";

import type { AxiosRequestConfig } from "axios";

jest.mock("axios");
jest.mock("node:timers/promises", () => ({ setTimeout: jest.fn() }));

const request = jest.mocked(axios.request);
const wait = jest.mocked(delay);
const INIT_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
const SESSION = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=SESSIONSECRET";
const SIZE = 10;
const FILE = Buffer.from("0123456789");
/** Total deadline for a tiny file: the 10 minute floor. */
const DEADLINE_MS = 600_000;
const metadata = {
  snippet: { title: "Title", description: "Description", tags: ["a"], categoryId: "22" },
  status: { privacyStatus: "private", publishAt: "2030-01-01T00:00:00.000Z", selfDeclaredMadeForKids: false },
};

let directory: string;
let filePath: string;
let streams: fs.ReadStream[];
let getAuthorization: jest.Mock<Promise<string>, []>;
let logger: { info: jest.Mock; warn: jest.Mock };

type Reply = { status: number; headers?: Record<string, unknown>; data?: unknown };
const reply = ({ status, headers = {}, data = "" }: Reply) =>
  ({ status, headers, data, statusText: "", config: {} }) as never;
const transportFailure = () =>
  Object.assign(new Error("timeout exceeded; Authorization: Bearer SECRET"), {
    code: "ECONNABORTED",
    config: { headers: { Authorization: "Bearer SECRET" }, url: SESSION },
  });
const revokedCredentials = () => ({ response: { status: 400, data: { error: "invalid_grant" } }, message: "SECRET" });

async function drain(data: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of data as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const initOk = () => reply({ status: 200, headers: { location: SESSION } });
const accepted = (id = "vid-123", uploadStatus?: string) =>
  reply({ status: 200, data: { id, ...(uploadStatus && { status: { uploadStatus } }) } });
const progress = (range?: string, extra: Record<string, unknown> = {}) =>
  reply({ status: 308, headers: range === undefined ? extra : { range, ...extra } });

/** Queue one handler per request, in order. */
function script(...steps: ((config: AxiosRequestConfig) => Promise<unknown> | unknown)[]) {
  for (const step of steps) request.mockImplementationOnce(async (config) => step(config) as never);
}
const isInit = (config: AxiosRequestConfig) => config.method === "POST";
const isProbe = (config: AxiosRequestConfig) =>
  config.method === "PUT" && config.headers?.["Content-Range"] === `bytes */${SIZE}` && config.data === undefined;
const inits = () => request.mock.calls.filter(([config]) => isInit(config)).length;
const probes = () => request.mock.calls.filter(([config]) => isProbe(config)).length;
const upload = () => uploadYouTubeVideo({ filePath, size: SIZE, metadata, getAuthorization, logger });
const failure = async () =>
  upload()
    .then(() => new Error("upload resolved unexpectedly"))
    .catch((error: unknown) => error);

beforeEach(() => {
  jest.resetAllMocks();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-resumable-unit-"));
  filePath = path.join(directory, "video.mp4");
  fs.writeFileSync(filePath, FILE);
  streams = [];
  const create = fs.createReadStream;
  jest.spyOn(fs, "createReadStream").mockImplementation(((p: fs.PathLike, o?: never) => {
    const stream = create(p, o);
    streams.push(stream);
    return stream;
  }) as unknown as typeof fs.createReadStream);
  getAuthorization = jest.fn(async () => "Bearer SECRET");
  logger = { info: jest.fn(), warn: jest.fn() };
  wait.mockImplementation(async () => {});
});

afterEach(async () => {
  jest.restoreAllMocks();
  // The helper destroys every stream; wait for the descriptors to close before removing the fixture.
  await Promise.all(streams.filter((stream) => !stream.closed).map((stream) => once(stream, "close")));
  fs.rmSync(directory, { recursive: true, force: true });
});

/** Neither errors nor log lines may carry credentials or the session URL. */
function expectNoLeak(error?: unknown) {
  const texts = [...logger.info.mock.calls, ...logger.warn.mock.calls].map(([message]) => String(message));
  if (error !== undefined) texts.push(`${(error as Error).message} ${JSON.stringify(error)}`);
  for (const text of texts) {
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("upload_id");
  }
}
const expectAmbiguous = (error: unknown, code: string) => {
  expect(error).toMatchObject({ errorType: PostErrorType.API_ERROR, details: { code } });
  expect((error as Error).message).toContain("check YouTube Studio before reposting");
  expectNoLeak(error);
};

it("initializes with metadata only, then streams the bytes once with explicit auth and no redirects", async () => {
  let body: Buffer | undefined;
  script(
    (config) => {
      expect(config.url).toBe(INIT_URL);
      expect(config.headers).toMatchObject({
        Authorization: "Bearer SECRET",
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": "10",
        "X-Upload-Content-Type": "application/octet-stream",
      });
      expect(JSON.parse(config.data as string)).toEqual(metadata);
      expect(config.timeout).toBe(30_000);
      return initOk();
    },
    async (config) => {
      expect(config.method).toBe("PUT");
      expect(config.url).toBe(SESSION);
      expect(config.headers).toMatchObject({
        Authorization: "Bearer SECRET",
        "Content-Type": "application/octet-stream",
        "Content-Length": "10",
      });
      expect(config.headers).not.toHaveProperty("Content-Range");
      expect(config.timeout).toBe(120_000);
      body = await drain(config.data);
      return accepted("vid-123", "uploaded");
    },
  );
  await expect(upload()).resolves.toEqual({ videoId: "vid-123", uploadStatus: "uploaded" });
  expect(body?.equals(FILE)).toBe(true);
  for (const [config] of request.mock.calls) {
    expect(config.maxRedirects).toBe(0);
    expect(config.validateStatus?.(500)).toBe(true);
  }
  expect(getAuthorization).toHaveBeenCalledTimes(2);
  expect(streams).toHaveLength(1);
  expect(streams[0].destroyed).toBe(true);
  expect(wait).not.toHaveBeenCalled();
  expectNoLeak();
});

it("returns the existing video ID when the upload timed out after full acceptance, without a second init", async () => {
  script(
    initOk,
    () => Promise.reject(transportFailure()),
    (config) => {
      expect(isProbe(config)).toBe(true);
      expect(config.headers).toMatchObject({ "Content-Length": "0", Authorization: "Bearer SECRET" });
      expect(config.url).toBe(SESSION);
      expect(config.timeout).toBe(30_000);
      return accepted("vid-done");
    },
  );
  await expect(upload()).resolves.toEqual({ videoId: "vid-done", uploadStatus: undefined });
  expect(inits()).toBe(1);
  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000]);
  expect(streams.every((stream) => stream.destroyed)).toBe(true);
});

it("resumes from the acknowledged offset with a fresh stream after a partial upload", async () => {
  const bodies: Buffer[] = [];
  script(
    initOk,
    (config) => {
      expect(config.headers).not.toHaveProperty("Content-Range");
      throw transportFailure();
    },
    () => progress("bytes=0-3"),
    async (config) => {
      expect(config.headers).toMatchObject({ "Content-Range": "bytes 4-9/10", "Content-Length": "6" });
      bodies.push(await drain(config.data));
      return accepted();
    },
  );
  await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
  expect(bodies[0].equals(FILE.subarray(4))).toBe(true);
  expect(streams).toHaveLength(2);
  expect(streams[0]).not.toBe(streams[1]);
  expect(streams.every((stream) => stream.destroyed)).toBe(true);
  expect(inits()).toBe(1);
});

it("restarts from zero when the probe reports no Range before any progress", async () => {
  script(
    initOk,
    () => Promise.reject(transportFailure()),
    () => progress(),
    async (config) => {
      expect(config.headers).not.toHaveProperty("Content-Range");
      expect(config.headers).toMatchObject({ "Content-Length": "10" });
      const body = await drain(config.data);
      expect(body.equals(FILE)).toBe(true);
      return accepted();
    },
  );
  await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
});

it("refuses to replay acknowledged bytes when a later probe omits the Range header", async () => {
  script(
    initOk,
    () => progress("bytes=0-5"),
    () => Promise.reject(transportFailure()),
    () => progress(),
  );
  const error = await failure();
  expectAmbiguous(error, "youtube_range_invalid");
  expect(request).toHaveBeenCalledTimes(4);
  expect(streams.every((stream) => stream.destroyed)).toBe(true);
});

it("continues directly after a progress 308 on the upload itself, without consuming recovery budget", async () => {
  script(
    initOk,
    () => progress("bytes=0-4"),
    async (config) => {
      expect(config.headers).toMatchObject({ "Content-Range": "bytes 5-9/10" });
      const body = await drain(config.data);
      expect(body.equals(FILE.subarray(5))).toBe(true);
      return accepted();
    },
  );
  await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
  expect(wait).not.toHaveBeenCalled();
});

it("stops a session that never makes progress instead of looping", async () => {
  request.mockImplementation(async (config) => (isInit(config) ? initOk() : progress()));
  const error = await failure();
  expectAmbiguous(error, "youtube_retry_budget");
  // 1 init + 3 uploads + 2 probes, then the budget is exhausted.
  expect(request).toHaveBeenCalledTimes(6);
  expect(inits()).toBe(1);
  expect(probes()).toBe(2);
  expect(streams.every((stream) => stream.destroyed)).toBe(true);
});

it("bounds recoveries to two with 1s/3s backoff and never re-initializes", async () => {
  request.mockImplementation(async (config) => {
    if (isInit(config)) return initOk();
    if (isProbe(config)) return progress("bytes=0-0");
    throw transportFailure();
  });
  const error = await failure();
  expectAmbiguous(error, "youtube_retry_budget");
  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 3000]);
  expect(inits()).toBe(1);
  expect(probes()).toBe(2);
  expect(streams).toHaveLength(3);
  expect(streams.every((stream) => stream.destroyed)).toBe(true);
});

it("consumes the remaining recovery budget on the same session when the probe itself fails transiently", async () => {
  script(
    initOk,
    () => Promise.reject(transportFailure()),
    () => Promise.reject(transportFailure()),
    () => progress("bytes=0-3"),
    async (config) => {
      expect(config.headers).toMatchObject({ "Content-Range": "bytes 4-9/10" });
      await drain(config.data);
      return accepted("vid-recovered");
    },
  );
  await expect(upload()).resolves.toMatchObject({ videoId: "vid-recovered" });
  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 3000]);
  expect(inits()).toBe(1);
  expect(probes()).toBe(2);
  for (const [config] of request.mock.calls) expect(config.url).toBe(config.method === "POST" ? INIT_URL : SESSION);
});

it("gives up after the budget when every probe is unreachable", async () => {
  script(initOk, () => Promise.reject(transportFailure()));
  request.mockImplementation(async () => {
    throw transportFailure();
  });
  const error = await failure();
  expectAmbiguous(error, "youtube_retry_budget");
  expect(request).toHaveBeenCalledTimes(4);
  expect(inits()).toBe(1);
  expect(probes()).toBe(2);
});

it("treats a transient probe answer as one recovery and then reads the final result", async () => {
  script(
    initOk,
    () => Promise.reject(transportFailure()),
    () => reply({ status: 502 }),
    () => accepted("vid-late"),
  );
  await expect(upload()).resolves.toMatchObject({ videoId: "vid-late" });
  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 3000]);
});

it.each([
  ["expired (404)", () => reply({ status: 404, data: { error: { message: "Not Found" } } })],
  ["redirected", () => reply({ status: 302, headers: { location: "https://evil.example/" } })],
  ["forbidden", () => reply({ status: 403, data: { error: { errors: [{ reason: "forbidden" }] } } })],
])("stops without another session when the probe is answered %s", async (_label, probe) => {
  script(initOk, () => Promise.reject(transportFailure()), probe);
  const error = await failure();
  expectAmbiguous(error, "youtube_session_lost");
  expect(request).toHaveBeenCalledTimes(3);
  expect(inits()).toBe(1);
  expect(wait).toHaveBeenCalledTimes(1);
});

it("stops at the total deadline without sending more requests", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  script(initOk, () => {
    clock.mockReturnValue(now + DEADLINE_MS + 1);
    throw transportFailure();
  });
  const error = await failure();
  expectAmbiguous(error, "youtube_upload_deadline");
  expect(request).toHaveBeenCalledTimes(2);
  expect(wait).not.toHaveBeenCalled();
});

it("rechecks the deadline after fetching credentials, before dispatching", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  script(initOk);
  getAuthorization.mockResolvedValueOnce("Bearer SECRET").mockImplementationOnce(async () => {
    // A slow token refresh consumed the whole budget.
    clock.mockReturnValue(now + DEADLINE_MS + 1);
    return "Bearer SECRET";
  });
  const error = await failure();
  expectAmbiguous(error, "youtube_upload_deadline");
  expect(request).toHaveBeenCalledTimes(1);
  expect(streams).toHaveLength(1);
  expect(streams[0].destroyed).toBe(true);
});

it("bounds each request by the remaining deadline", async () => {
  const now = Date.now();
  const clock = jest.spyOn(Date, "now").mockReturnValue(now);
  script(
    initOk,
    (config) => {
      expect(config.timeout).toBe(120_000);
      clock.mockReturnValue(now + DEADLINE_MS - 10_000);
      throw transportFailure();
    },
    (config) => {
      expect(config.timeout).toBe(10_000);
      return accepted();
    },
  );
  await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
});

describe("Retry-After", () => {
  it("waits for the longer of the provider hint and the local backoff on a transient error", async () => {
    script(
      initOk,
      () => reply({ status: 503, headers: { "retry-after": "5" } }),
      () => progress("bytes=0-1"),
      async (config) => {
        expect(config.headers).toMatchObject({ "Content-Range": "bytes 2-9/10" });
        await drain(config.data);
        return accepted();
      },
    );
    await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([5000]);
  });

  it("never shortens the local backoff because of a small hint", async () => {
    script(
      initOk,
      () => reply({ status: 429, headers: { "retry-after": "0" } }),
      () => accepted(),
    );
    await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000]);
  });

  it("is honored on a 308 before the next chunk and before the next probe", async () => {
    script(
      initOk,
      () => progress("bytes=0-4", { "retry-after": "2" }),
      async (config) => {
        expect(config.headers).toMatchObject({ "Content-Range": "bytes 5-9/10" });
        await drain(config.data);
        return progress("bytes=0-4", { "retry-after": "7" });
      },
      () => accepted(),
    );
    await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([2000, 7000]);
    expect(probes()).toBe(1);
  });

  it("honors an HTTP-date hint relative to the current time", async () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    jest.spyOn(Date, "now").mockReturnValue(now);
    script(
      initOk,
      () => reply({ status: 503, headers: { "retry-after": "Thu, 01 Jan 2026 00:00:10 GMT" } }),
      () => accepted(),
    );
    await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([10_000]);
  });

  it.each(["86400", "99999999999999999999", "Fri, 01 Jan 2100 00:00:00 GMT"])(
    "refuses the hint %p beyond the remaining budget instead of waiting or parsing it as a short delay",
    async (hint) => {
      script(initOk, () => reply({ status: 503, headers: { "retry-after": hint } }));
      const error = await failure();
      expectAmbiguous(error, "youtube_upload_deadline");
      expect(request).toHaveBeenCalledTimes(2);
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it("falls back to the local backoff for an unparseable hint", async () => {
    script(
      initOk,
      () => reply({ status: 503, headers: { "retry-after": "soon" } }),
      () => accepted(),
    );
    await expect(upload()).resolves.toMatchObject({ videoId: "vid-123" });
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000]);
  });
});

describe("init", () => {
  it.each([
    [400, "uploadLimitExceeded", PostErrorType.RATE_LIMIT_ERROR, "youtube_upload_limit"],
    [401, "authError", PostErrorType.CREDENTIALS_ERROR, "youtube_credentials_revoked"],
    [403, "quotaExceeded", PostErrorType.PUBLISH_REJECTED, "youtube_init_rejected"],
    [400, "invalidTitle", PostErrorType.PUBLISH_REJECTED, "youtube_init_rejected"],
    [500, "backendError", PostErrorType.PUBLISH_REJECTED, "youtube_init_rejected"],
    [302, undefined, PostErrorType.PUBLISH_REJECTED, "youtube_init_rejected"],
  ])("classifies an explicit rejection %s/%s as %s without uploading", async (status, reason, errorType, code) => {
    script(() =>
      reply({
        status,
        headers: status === 302 ? { location: "https://evil.example/upload" } : {},
        data: reason ? { error: { message: "Raw provider text SECRET", errors: [{ reason }] } } : "",
      }),
    );
    const error = await failure();
    expect(error).toMatchObject({ errorType, details: { stage: "init", httpStatus: status, code } });
    expect((error as { details: { reasons: string[] } }).details.reasons).toEqual(reason ? [reason] : []);
    expect((error as Error).message).not.toContain("Raw provider text");
    expect(request).toHaveBeenCalledTimes(1);
    expect(streams).toHaveLength(0);
    expectNoLeak(error);
  });

  it("keeps only allowlisted, bounded reason codes in diagnostics", async () => {
    const errors = [
      { reason: "<script>alert(1)</script>" },
      { reason: "invalidTitle" },
      { reason: 42 },
      "junk",
      ...Array.from({ length: 10 }, () => ({ reason: "badRequest" })),
    ];
    script(() => reply({ status: 400, data: { error: { message: "x", errors } } }));
    const error = await failure();
    expect((error as { details: { reasons: string[] } }).details.reasons).toEqual([
      "invalidTitle",
      "badRequest",
      "badRequest",
      "badRequest",
      "badRequest",
    ]);
    expect(JSON.stringify(error)).not.toContain("script");
  });

  it("classifies a transport failure as safely retryable", async () => {
    script(() => Promise.reject(transportFailure()));
    const error = await failure();
    expect(error).toMatchObject({
      errorType: PostErrorType.PUBLISH_REJECTED,
      details: { stage: "init", code: "youtube_init_unreachable" },
    });
    expect((error as Error).message).toContain("safe to retry");
    expectNoLeak(error);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("reports revoked credentials from the token provider as a credentials error", async () => {
    getAuthorization.mockRejectedValueOnce(revokedCredentials());
    const error = await failure();
    expect(error).toMatchObject({
      errorType: PostErrorType.CREDENTIALS_ERROR,
      details: { stage: "init", code: "youtube_credentials_revoked" },
    });
    expect((error as Error).message).toContain("reconnect your YouTube account");
    expectNoLeak(error);
    expect(request).not.toHaveBeenCalled();
  });

  it("reports a transient token provider failure as safely retryable", async () => {
    getAuthorization.mockRejectedValueOnce(Object.assign(new Error("ETIMEDOUT SECRET"), { code: "ETIMEDOUT" }));
    const error = await failure();
    expect(error).toMatchObject({
      errorType: PostErrorType.PUBLISH_REJECTED,
      details: { stage: "init", code: "youtube_init_unreachable" },
    });
    expectNoLeak(error);
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    "http://www.googleapis.com/upload/youtube/v3/videos?upload_id=x",
    "https://evil.example/upload/youtube/v3/videos?upload_id=x",
    "https://www.googleapis.com.evil.example/upload/youtube/v3/videos?upload_id=x",
    "https://user:pass@www.googleapis.com/upload/youtube/v3/videos?upload_id=x",
    "https://www.googleapis.com:8443/upload/youtube/v3/videos?upload_id=x",
    "https://www.googleapis.com/upload/youtube/v3/videos/../../other?upload_id=x",
    "https://www.googleapis.com/other/path?upload_id=x",
    "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=x#fragment",
    "",
    undefined,
  ])("refuses the untrusted session URL %p without sending media", async (location) => {
    expect(isTrustedSessionUrl(location)).toBe(false);
    script(() => reply({ status: 200, headers: location === undefined ? {} : { location } }));
    const error = await failure();
    expect(error).toMatchObject({
      errorType: PostErrorType.API_ERROR,
      details: { stage: "init", code: "youtube_session_url_untrusted" },
    });
    expect((error as Error).message).toContain("No video was created");
    expect(JSON.stringify(error)).not.toContain("upload_id");
    expect(request).toHaveBeenCalledTimes(1);
    expect(streams).toHaveLength(0);
  });

  it("accepts only the exact Google upload endpoint", () => {
    expect(isTrustedSessionUrl(SESSION)).toBe(true);
    expect(isTrustedSessionUrl("https://www.googleapis.com/upload/youtube/v3/videos")).toBe(true);
  });
});

it("does not retry or re-initialize after a definitive rejection of the media PUT", async () => {
  script(initOk, () => reply({ status: 403, data: { error: { message: "Forbidden", errors: [{ reason: "x" }] } } }));
  const error = await failure();
  expect(error).toMatchObject({
    errorType: PostErrorType.API_ERROR,
    details: { stage: "upload", code: "youtube_upload_rejected", httpStatus: 403 },
  });
  expect(request).toHaveBeenCalledTimes(2);
  expect(wait).not.toHaveBeenCalled();
  expect(streams[0].destroyed).toBe(true);
});

it("reports revoked credentials before any byte was sent and ambiguity afterwards", async () => {
  getAuthorization.mockResolvedValueOnce("Bearer SECRET").mockRejectedValueOnce(revokedCredentials());
  script(initOk);
  let error = await failure();
  expect(error).toMatchObject({
    errorType: PostErrorType.CREDENTIALS_ERROR,
    details: { stage: "upload", code: "youtube_credentials_revoked" },
  });
  expectNoLeak(error);
  expect(request).toHaveBeenCalledTimes(1);
  expect(streams[0].destroyed).toBe(true);

  jest.clearAllMocks();
  getAuthorization
    .mockResolvedValueOnce("Bearer SECRET")
    .mockResolvedValueOnce("Bearer SECRET")
    .mockRejectedValueOnce(revokedCredentials());
  script(initOk, () => Promise.reject(transportFailure()));
  error = await failure();
  expect(error).toMatchObject({
    errorType: PostErrorType.API_ERROR,
    details: { stage: "recover", code: "youtube_authorization_unavailable" },
  });
  expectNoLeak(error);
  expect(request).toHaveBeenCalledTimes(2);
});

it("recovers from a transient token provider failure after bytes were sent", async () => {
  getAuthorization
    .mockResolvedValueOnce("Bearer SECRET")
    .mockResolvedValueOnce("Bearer SECRET")
    .mockRejectedValueOnce(Object.assign(new Error("ECONNRESET SECRET"), { code: "ECONNRESET" }));
  script(
    initOk,
    () => Promise.reject(transportFailure()),
    () => accepted("vid-after-refresh"),
  );
  await expect(upload()).resolves.toMatchObject({ videoId: "vid-after-refresh" });
  expect(wait.mock.calls.map(([ms]) => ms)).toEqual([1000, 3000]);
  expect(request).toHaveBeenCalledTimes(3);
});

it.each([
  ["garbage", "youtube_range_invalid"],
  ["bytes=1-5", "youtube_range_invalid"],
  ["bytes=0-20", "youtube_range_invalid"],
  ["bytes=0-9", "youtube_retry_budget"],
])("handles the 308 Range %p on the upload as %s", async (range, code) => {
  request.mockImplementation(async (config) => (isInit(config) ? initOk() : progress(range)));
  const error = await failure();
  expectAmbiguous(error, code);
  if (code === "youtube_retry_budget") {
    // Everything stored without a final answer can only be resolved by probes within the budget.
    expect(probes()).toBe(2);
    expect(request).toHaveBeenCalledTimes(4);
  } else {
    expect(request).toHaveBeenCalledTimes(2);
  }
  expect(inits()).toBe(1);
  expect(streams.every((stream) => stream.destroyed)).toBe(true);
});

it("rejects a regressing acknowledgement from a probe", async () => {
  script(
    initOk,
    () => progress("bytes=0-5"),
    () => Promise.reject(transportFailure()),
    () => progress("bytes=0-2"),
  );
  const error = await failure();
  expectAmbiguous(error, "youtube_range_invalid");
  expect(request).toHaveBeenCalledTimes(4);
});

it.each([{}, { id: "" }, { id: "../x" }, { id: 42 }, { id: "a".repeat(65) }, null])(
  "requires a well-formed video ID in the final response (%j)",
  async (data) => {
    script(initOk, () => reply({ status: 200, data }));
    const error = await failure();
    expectAmbiguous(error, "youtube_video_id_missing");
    expect(request).toHaveBeenCalledTimes(2);
  },
);

it("rejects an empty file before contacting YouTube", async () => {
  await expect(uploadYouTubeVideo({ filePath, size: 0, metadata, getAuthorization })).rejects.toMatchObject({
    errorType: PostErrorType.INVALID_CONTENT,
  });
  expect(request).not.toHaveBeenCalled();
});

describe("unreadable file", () => {
  it("is reported as a preparation error before any byte is sent, without hanging a request", async () => {
    fs.rmSync(filePath);
    script(initOk);
    const error = await failure();
    expect(error).toMatchObject({
      errorType: PostErrorType.PREPARATION_ERROR,
      details: { stage: "upload", code: "youtube_file_unreadable" },
    });
    expect((error as Error).message).toContain("No video was created");
    expect(request).toHaveBeenCalledTimes(1);
    expect(streams).toHaveLength(1);
    expect(streams[0].destroyed).toBe(true);
  });

  it("is ambiguous once bytes may have been sent", async () => {
    script(
      initOk,
      () => {
        fs.rmSync(filePath);
        throw transportFailure();
      },
      () => progress("bytes=0-3"),
    );
    const error = await failure();
    expectAmbiguous(error, "youtube_file_unreadable");
    expect(request).toHaveBeenCalledTimes(3);
    expect(streams).toHaveLength(2);
    expect(streams.every((stream) => stream.destroyed)).toBe(true);
  });
});

describe("pure helpers", () => {
  it("parses Retry-After as seconds or an HTTP-date, never a huge number as a date", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfterMs("3", now)).toBe(3000);
    expect(parseRetryAfterMs(" 3 ", now)).toBe(3000);
    expect(parseRetryAfterMs("Thu, 01 Jan 2026 00:00:10 GMT", now)).toBe(10_000);
    expect(parseRetryAfterMs("Wed, 31 Dec 2025 23:59:00 GMT", now)).toBe(0);
    expect(parseRetryAfterMs("99999999999999999999", now)).toBeGreaterThan(1e20);
    expect(parseRetryAfterMs("soon", now)).toBeUndefined();
    expect(parseRetryAfterMs(5, now)).toBeUndefined();
    expect(parseRetryAfterMs(undefined, now)).toBeUndefined();
  });

  it("maps acknowledged ranges to the next offset and rejects regressions", () => {
    expect(parseAcknowledgedBytes(undefined, 10, 0)).toBe(0);
    expect(parseAcknowledgedBytes("", 10, 0)).toBe(0);
    expect(parseAcknowledgedBytes("bytes=0-3", 10, 0)).toBe(4);
    expect(parseAcknowledgedBytes("bytes=0-3", 10, 4)).toBe(4);
    expect(parseAcknowledgedBytes("bytes=0-9", 10, 4)).toBe(10);
    expect(parseAcknowledgedBytes(undefined, 10, 4)).toBeUndefined();
    expect(parseAcknowledgedBytes("bytes=0-2", 10, 4)).toBeUndefined();
    expect(parseAcknowledgedBytes("bytes=0-10", 10, 0)).toBeUndefined();
    expect(parseAcknowledgedBytes("bytes=1-5", 10, 0)).toBeUndefined();
    expect(parseAcknowledgedBytes(["bytes=0-3"], 10, 0)).toBeUndefined();
  });
});
