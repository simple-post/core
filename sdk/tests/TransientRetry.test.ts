import { httpStatus, isTransientError, retryAfterMs, withTransientRetry } from "../src/utils/transient-retry";

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-22T12:00:00Z"));
});
afterEach(() => jest.useRealTimers());

it("bounds retry attempts and preserves the original error", async () => {
  const error = { response: { status: 503 } };
  const operation = jest.fn().mockRejectedValue(error);
  const result = withTransientRetry(operation).catch((error_) => error_);
  await jest.advanceTimersByTimeAsync(999);
  expect(operation).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(operation).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(3000);
  expect(await result).toBe(error);
  expect(operation).toHaveBeenCalledTimes(3);
});

it.each([400, 401, 403, 404, 413, 422, 501])("does not retry permanent HTTP %i", async (status) => {
  const operation = jest.fn().mockRejectedValue({ response: { status } });
  await expect(withTransientRetry(operation)).rejects.toEqual({ response: { status } });
  expect(operation).toHaveBeenCalledTimes(1);
});

it("retries a transport failure and returns the successful result", async () => {
  const operation = jest.fn().mockRejectedValueOnce({ code: "ECONNRESET" }).mockResolvedValue("done");
  const result = withTransientRetry(operation);
  await jest.runAllTimersAsync();
  expect(await result).toBe("done");
  expect(operation).toHaveBeenCalledTimes(2);
});

it("uses provider waits without exceeding the deadline or shortening long waits", async () => {
  const error = { response: { status: 429, headers: { "Retry-After": "5" } } };
  const operation = jest.fn().mockRejectedValueOnce(error).mockResolvedValue("done");
  const result = withTransientRetry(operation);
  await jest.advanceTimersByTimeAsync(4999);
  expect(operation).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(await result).toBe("done");
  const blocked = jest.fn().mockRejectedValue(error);
  await expect(withTransientRetry(blocked, { deadline: Date.now() + 4000 })).rejects.toBe(error);
  expect(blocked).toHaveBeenCalledTimes(1);
  error.response.headers["Retry-After"] = "3600";
  await expect(withTransientRetry(blocked)).rejects.toBe(error);
  expect(blocked).toHaveBeenCalledTimes(2);
});

it("handles date headers, Telegram flood waits and X reset timestamps", () => {
  expect(retryAfterMs({ response: { headers: new Headers({ "retry-after": "Thu, 22 Oct 2026 12:00:05 GMT" }) } })).toBe(
    5000,
  );
  expect(retryAfterMs({ response: { status: 429, data: { parameters: { retry_after: 7 } } } })).toBe(7000);
  expect(retryAfterMs({ code: 429, headers: { "x-rate-limit-reset": String(Date.now() / 1000 + 9) } })).toBe(9000);
  expect(retryAfterMs({ response: { headers: { "retry-after": "nonsense" } } })).toBeUndefined();
  expect(isTransientError(new Error("HTTP 503"))).toBe(false);
  expect(isTransientError({ response: { status: 401 }, code: "ECONNRESET" })).toBe(false);
  expect(httpStatus({ code: "secret" })).toBeUndefined();
});

it("allows a provider-specific rejection predicate without retrying other failures", async () => {
  const error = { response: { status: 500 } };
  const operation = jest.fn().mockRejectedValue(error);
  await expect(withTransientRetry(operation, { shouldRetry: () => false })).rejects.toBe(error);
  expect(operation).toHaveBeenCalledTimes(1);
});
