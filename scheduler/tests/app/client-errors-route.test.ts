import { NextRequest } from "next/server";

import { POST } from "@/app/api/internal/client-errors/route";
import { createLogger } from "@/lib/logger";
import { getSession } from "@/lib/middleware/auth";

jest.mock("@/lib/logger", () => ({
  createLogger: jest.fn(() => ({ error: jest.fn(), warn: jest.fn() })),
  serializeError: jest.fn((error: unknown) => ({ message: String(error) })),
}));
jest.mock("@/lib/middleware/auth", () => ({ getSession: jest.fn() }));

const logger = (createLogger as jest.MockedFunction<typeof createLogger>).mock.results[0]?.value as unknown as {
  error: jest.Mock;
  warn: jest.Mock;
};
const getSessionMock = getSession as jest.MockedFunction<typeof getSession>;

function request(body: unknown): NextRequest {
  return new NextRequest("https://app.simplepost.social/api/internal/client-errors", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  getSessionMock.mockResolvedValue(null);
});

it("silently discards browser extension errors", async () => {
  const response = await POST(
    request({
      level: "error",
      message: "Unhandled browser error",
      error: {
        name: "TypeError",
        message: "t is not a function",
        stack:
          "TypeError: t is not a function\n" +
          "    at t (chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn/scripts/inpage.js:17:27984)",
      },
    }),
  );

  expect(response.status).toBe(204);
  expect(getSessionMock).not.toHaveBeenCalled();
  expect(logger.error).not.toHaveBeenCalled();
  expect(logger.warn).not.toHaveBeenCalled();
});

it("continues to log application errors", async () => {
  const response = await POST(
    request({
      level: "error",
      message: "Unhandled browser error",
      error: {
        name: "TypeError",
        message: "Failed to publish",
        stack:
          "TypeError: Failed to publish\n" +
          "    at publishPost (https://app.simplepost.social/_next/static/chunks/app.js:10:20)",
      },
    }),
  );

  expect(response.status).toBe(204);
  expect(getSessionMock).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({
      err: expect.objectContaining({ message: "Failed to publish" }),
      errorName: "TypeError",
      errorMessage: "Failed to publish",
      errorStack: expect.stringContaining("publishPost"),
      clientUrl: undefined,
      clientUserAgent: undefined,
    }),
    "Unhandled browser error",
  );
});
