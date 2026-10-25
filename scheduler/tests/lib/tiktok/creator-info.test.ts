import { createLogger } from "@/lib/logger";
import { fetchTikTokCreatorInfo } from "@/lib/tiktok/creator-info";

jest.mock("@/lib/logger", () => ({ createLogger: jest.fn(() => ({ warn: jest.fn() })) }));
const fetchMock = jest.fn();
const logger = jest.mocked(createLogger).mock.results[0].value;
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as typeof fetch;
});

it("logs the complete safe rejection while preserving the existing creator response", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        error: {
          code: "invalid_param",
          message: "Check creator-access-token",
          log_id: "creator_log",
          detail: { field: "creator" },
        },
      }),
      { status: 400, headers: { "x-tt-logid": "creator_header", "set-cookie": "session-cookie" } },
    ),
  );
  expect(await fetchTikTokCreatorInfo("creator-access-token")).toMatchObject({
    canPost: false,
    errorCode: "invalid_param",
    blockReason: "Check [REDACTED]",
  });
  const log = logger;
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({
        httpStatus: 400,
        logId: "creator_log",
        providerResponse: {
          error: {
            code: "invalid_param",
            message: "Check [REDACTED]",
            log_id: "creator_log",
            detail: { field: "creator" },
          },
        },
      }),
    }),
    expect.any(String),
  );
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain("creator-access-token");
  expect(JSON.stringify(log.warn.mock.calls)).not.toContain("session-cookie");
});

it("keeps malformed response bodies instead of discarding them", async () => {
  fetchMock.mockResolvedValue(new Response("<html>Gateway unavailable</html>", { status: 502 }));
  expect(await fetchTikTokCreatorInfo("token")).toMatchObject({ canPost: false, errorCode: "request_failed" });
  const log = logger;
  expect(log.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({ providerResponse: "<html>Gateway unavailable</html>", httpStatus: 502 }),
    }),
    expect.any(String),
  );
});

it("logs transport failures while reading a response, including its HTTP status", async () => {
  const response = new Response("unused", { status: 502, headers: { "x-tt-logid": "read_failure" } });
  jest.spyOn(response, "text").mockRejectedValue(new Error("connection lost"));
  fetchMock.mockResolvedValue(response);
  await expect(fetchTikTokCreatorInfo("token")).rejects.toThrow("response could not be read");
  expect(logger.warn).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({
        httpStatus: 502,
        logId: "read_failure",
        transport: expect.objectContaining({ cause: expect.objectContaining({ message: "connection lost" }) }),
      }),
    }),
    expect.any(String),
  );
});
