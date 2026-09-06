import fs from "node:fs";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import axios from "axios";

import { BLUESKY_MAX_VIDEO_SIZE_BYTES } from "../src/publishers/bluesky/validation";
import { uploadBlueskyVideo } from "../src/publishers/bluesky/video";
import { PostErrorType } from "../src/types";

jest.mock("axios");
jest.mock("node:timers/promises", () => ({ setTimeout: jest.fn() }));
jest.mock("node:fs", () => ({
  ...jest.requireActual("node:fs"),
  existsSync: jest.fn(),
  statSync: jest.fn(),
  createReadStream: jest.fn(),
}));

const http = axios as jest.Mocked<typeof axios>;
const files = fs as jest.Mocked<typeof fs>;
const wait = delay as jest.MockedFunction<typeof delay>;
const token = jest.fn(async () => "service-token");
const blob = { $type: "blob", ref: { $link: "video-cid" }, mimeType: "video/mp4", size: 512 };
const pending = { jobId: "job-1", state: "JOB_STATE_ENCODING" };
let stream: Readable;

beforeEach(() => {
  jest.resetAllMocks();
  token.mockResolvedValue("service-token");
  files.existsSync.mockReturnValue(true);
  files.statSync.mockReturnValue({ size: 1024 } as fs.Stats);
  stream = Readable.from([Buffer.from("video")]);
  files.createReadStream.mockReturnValue(stream as fs.ReadStream);
  wait.mockImplementation(async () => {});
});

afterEach(() => jest.restoreAllMocks());

it("waits through processing states, streams the upload and releases the stream", async () => {
  http.post.mockResolvedValue({ data: pending });
  http.get
    .mockResolvedValueOnce({ data: { jobStatus: { ...pending, state: "JOB_STATE_SCANNING" } } })
    .mockResolvedValueOnce({ data: { jobStatus: { ...pending, state: "JOB_STATE_COMPLETED", blob } } });
  await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).resolves.toEqual(blob);
  expect(http.post.mock.calls[0][1]).toBe(stream);
  expect(http.get).toHaveBeenCalledTimes(2);
  expect(http.get).toHaveBeenLastCalledWith(
    "https://video.bsky.app/xrpc/app.bsky.video.getJobStatus",
    expect.objectContaining({ params: { jobId: "job-1" } }),
  );
  expect(stream.destroyed).toBe(true);
});

it.each(["raw", "wrapped", "upload-error", "poll-error"])("reuses already processed video (%s)", async (mode) => {
  const job = { ...pending, state: "JOB_STATE_FAILED", error: "already_exists", blob };
  if (mode === "upload-error") http.post.mockRejectedValue({ response: { data: job } });
  else if (mode === "poll-error") {
    http.post.mockResolvedValue({ data: pending });
    http.get.mockRejectedValue({ response: { data: { jobStatus: job } } });
  } else http.post.mockResolvedValue({ data: mode === "raw" ? job : { jobStatus: job } });
  await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).resolves.toEqual(blob);
});

it.each(["raw", "wrapped"])("resumes a duplicate upload which is still processing (%s)", async (shape) => {
  const data =
    shape === "raw" ? { ...pending, error: "already_exists" } : { error: "already_exists", jobStatus: pending };
  http.post.mockRejectedValue({ response: { data } });
  http.get.mockResolvedValue({ data: { jobStatus: { ...pending, blob } } });
  await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).resolves.toEqual(blob);
});

it.each([0, BLUESKY_MAX_VIDEO_SIZE_BYTES + 1])(
  "rejects actual file size %i before obtaining credentials",
  async (size) => {
    files.statSync.mockReturnValue({ size } as fs.Stats);
    await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).rejects.toMatchObject({
      errorType: PostErrorType.INVALID_CONTENT,
    });
    expect(token).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  },
);

it("allows the exact size limit", async () => {
  files.statSync.mockReturnValue({ size: BLUESKY_MAX_VIDEO_SIZE_BYTES } as fs.Stats);
  http.post.mockResolvedValue({ data: { ...pending, blob } });
  await expect(uploadBlueskyVideo("video.MP4", "did:plc:user", token)).resolves.toEqual(blob);
});

it("rejects a missing file", async () => {
  files.existsSync.mockReturnValue(false);
  await expect(uploadBlueskyVideo("missing.mp4", "did:plc:user", token)).rejects.toMatchObject({
    errorType: PostErrorType.INVALID_CONTENT,
  });
});

it("rejects unsupported resolved file formats", async () => {
  await expect(uploadBlueskyVideo("video.webm", "did:plc:user", token)).rejects.toThrow("MP4");
  expect(token).not.toHaveBeenCalled();
});

it.each([
  { ...pending, state: "JOB_STATE_FAILED", message: "Video exceeds duration limit" },
  { ...pending, error: "validation_failure", message: "Video exceeds duration limit" },
])("surfaces processing failures (%j)", async (job) => {
  http.post.mockResolvedValue({ data: pending });
  http.get.mockResolvedValue({ data: { jobStatus: job } });
  await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).rejects.toThrow("Video exceeds duration limit");
});

it.each([{}, null, { jobStatus: null }, { state: "JOB_STATE_COMPLETED" }])(
  "fails on unusable job responses (%j)",
  async (data) => {
    http.post.mockResolvedValue({ data });
    await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).rejects.toMatchObject({
      errorType: PostErrorType.API_ERROR,
    });
    expect(http.get).not.toHaveBeenCalled();
  },
);

it.each(["raw", "wrapped", "conflict"])("fetches the blob for an already completed upload (%s)", async (shape) => {
  const completed = { ...pending, state: "JOB_STATE_COMPLETED", error: "already_exists" };
  if (shape === "conflict") http.post.mockRejectedValue({ response: { status: 409, data: completed } });
  else http.post.mockResolvedValue({ data: shape === "raw" ? completed : { jobStatus: completed } });
  http.get.mockResolvedValue({ data: { jobStatus: { ...completed, blob } } });
  await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).resolves.toEqual(blob);
  expect(http.post).toHaveBeenCalledTimes(1);
  expect(http.get).toHaveBeenCalledTimes(1);
});

it("bounds completed jobs that never expose a blob without uploading again", async () => {
  let now = 0;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  wait.mockImplementation(async () => {
    now += 150_000;
  });
  const completed = { ...pending, state: "JOB_STATE_COMPLETED" };
  http.post.mockResolvedValue({ data: completed });
  http.get.mockResolvedValue({ data: { jobStatus: completed } });
  await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).rejects.toThrow("timed out");
  expect(http.post).toHaveBeenCalledTimes(1);
  expect(http.get).toHaveBeenCalledTimes(1);
});

it("bounds the processing wait", async () => {
  let now = 0;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  wait.mockImplementation(async () => {
    now += 300_000;
  });
  http.post.mockResolvedValue({ data: pending });
  await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).rejects.toThrow("timed out");
  expect(http.get).not.toHaveBeenCalled();
});

it.each(["EmailNotConfirmed", "DailyUploadLimitExceeded"])(
  "preserves account errors (%s) and closes the upload stream",
  async (error) => {
    http.post.mockRejectedValue({ response: { data: { error } } });
    await expect(uploadBlueskyVideo("video.mp4", "did:plc:user", token)).rejects.toThrow(error);
    expect(stream.destroyed).toBe(true);
  },
);
