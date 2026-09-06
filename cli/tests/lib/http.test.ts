import { extractErrorMessage } from "../../src/lib/http.js";

describe("extractErrorMessage", () => {
  it("includes scheduler validation details in the CLI error", () => {
    expect(
      extractErrorMessage(
        {
          code: "VALIDATION_ERROR",
          error: "Validation failed",
          details: {
            summary: {
              errors: [{ message: "Instagram posts require an image or video." }],
            },
          },
        },
        "fallback",
      ),
    ).toBe("Validation failed: Instagram posts require an image or video.");
  });
});
