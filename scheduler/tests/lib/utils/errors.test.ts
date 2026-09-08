import { apiLogger } from "@/lib/logger";
import { handleApiError, PaymentRequiredError, ValidationError } from "@/lib/utils/errors";

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
        error: "PaymentRequiredError",
        errorMessage: "An active SimplePost subscription is required",
        statusCode: 402,
        code: "PAYMENT_REQUIRED",
      }),
      "API request rejected",
    );

    await expect(response.json()).resolves.toEqual({
      error: "An active SimplePost subscription is required",
      code: "PAYMENT_REQUIRED",
    });
  });
});

it("logs validation reasons once at warning severity without account data", async () => {
  jest.clearAllMocks();
  const error = new ValidationError({
    summary: {
      errors: [
        {
          platform: "instagram",
          code: "image_format_unsupported",
          field: "media[0]",
          message: "Instagram does not support PNG",
        },
      ],
    },
    accounts: [{ accessToken: "secret" }],
  });
  const response = handleApiError(error);
  expect(response.status).toBe(400);
  expect(mockApiLogger.error).not.toHaveBeenCalled();
  expect(mockApiLogger.warn).toHaveBeenCalledTimes(1);
  const payload = mockApiLogger.warn.mock.calls[0][0];
  expect(payload.validationIssueCount).toBe(1);
  expect(payload.validationIssues).toContain("Instagram does not support PNG");
  expect(JSON.stringify(payload)).not.toContain("secret");
});
