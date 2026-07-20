import { apiLogger } from "@/lib/logger";
import { handleApiError, PaymentRequiredError } from "@/lib/utils/errors";

jest.mock("@/lib/logger", () => ({
  apiLogger: {
    warn: jest.fn(),
    error: jest.fn(),
  },
  serializeError: (error: Error) => ({ name: error.name, message: error.message }),
}));

const mockApiLogger = apiLogger as unknown as {
  warn: jest.Mock;
  error: jest.Mock;
};

describe("API error logging", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("logs private billing diagnostics without returning them to the caller", async () => {
    const response = handleApiError(
      new PaymentRequiredError("An active SimplePost subscription is required", {
        userId: "user-1",
        maskedEmail: "vl***ir@example.com",
        subscriptionStatus: "past_due",
        platform: "x",
        platformAccountId: "123456789",
      }),
    );

    expect(mockApiLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        maskedEmail: "vl***ir@example.com",
        subscriptionStatus: "past_due",
        platform: "x",
        platformAccountId: "123456789",
        statusCode: 402,
        code: "PAYMENT_REQUIRED",
      }),
      "API error occurred",
    );

    await expect(response.json()).resolves.toEqual({
      error: "An active SimplePost subscription is required",
      code: "PAYMENT_REQUIRED",
    });
  });
});
