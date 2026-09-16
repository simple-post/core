import { McpToolError, toMcpErrorDiagnostic } from "@/lib/mcp/tool-errors";
import { BadRequestError, PaymentRequiredError } from "@/lib/utils/errors";

describe("toMcpErrorDiagnostic", () => {
  it("preserves structured MCP recovery instructions", () => {
    const error = new McpToolError({
      code: "MEDIA_SOURCE_UNAVAILABLE",
      stage: "source_download",
      recovery: "retry_same",
      maxAutomaticRetries: 1,
      message: "Retry once.",
      statusCode: 503,
    });

    expect(toMcpErrorDiagnostic(error)).toEqual({
      code: "MEDIA_SOURCE_UNAVAILABLE",
      stage: "source_download",
      recovery: "retry_same",
      maxAutomaticRetries: 1,
      message: "Retry once.",
    });
  });

  it("keeps ordinary API errors non-retryable", () => {
    expect(toMcpErrorDiagnostic(new BadRequestError("Invalid input"))).toEqual({
      code: "BAD_REQUEST",
      stage: "tool_execution",
      recovery: "stop",
      maxAutomaticRetries: 0,
      message: "Invalid input",
    });
  });

  it("tells the model not to retry a billing denial", () => {
    expect(toMcpErrorDiagnostic(new PaymentRequiredError("Upgrade required", { gate: "subscription" }))).toEqual({
      code: "PAYMENT_REQUIRED",
      stage: "billing",
      recovery: "stop",
      maxAutomaticRetries: 0,
      message: "Upgrade required Do not retry until the user changes their plan or allowance in SimplePost.",
    });
  });
});
