import { S3Client } from "@aws-sdk/client-s3";

import { deleteFromStorage } from "../src/utils/s3";

jest.mock("@aws-sdk/client-s3", () => ({ S3Client: jest.fn(), DeleteObjectCommand: jest.fn() }));

it("aborts stalled storage deletion and releases its deadline timer", async () => {
  jest.useFakeTimers();
  const previous = { ...process.env };
  Object.assign(process.env, {
    S3_STORAGE_ACCESS_KEY_ID: "test",
    S3_STORAGE_SECRET_ACCESS_KEY: "test",
    S3_STORAGE_REGION: "auto",
    S3_STORAGE_BUCKET: "test",
    S3_STORAGE_BASE_URL: "https://media.example.com",
  });
  const send = jest.fn(
    (_command, options) =>
      new Promise((_resolve, reject) => {
        options.abortSignal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  jest.mocked(S3Client).mockImplementation(() => ({ send }) as unknown as S3Client);
  try {
    const pending = deleteFromStorage("uploads/user/unused.png", { timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toThrow("aborted");
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(send).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    process.env = previous;
    jest.useRealTimers();
  }
});
