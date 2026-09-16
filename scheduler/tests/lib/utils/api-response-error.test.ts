import { apiResponseError } from "@/lib/utils/api-response-error";

it("prioritizes blocking summary errors over provider warnings", () => {
  expect(
    apiResponseError(
      {
        details: {
          results: [{ warnings: [{ message: "Consider a shorter caption." }] }],
          summary: { errors: [{ message: "Instagram requires JPEG." }] },
        },
      },
      "Failed",
    ),
  ).toBe("Instagram requires JPEG.");
});

it("surfaces structured provider validation issues instead of generic text", () => {
  expect(
    apiResponseError({ error: "Validation failed", details: [{ message: "Instagram requires JPEG." }] }, "Failed"),
  ).toBe("Instagram requires JPEG.");
});

it("includes automatic image-fitting guidance with a fixable validation error", () => {
  expect(
    apiResponseError(
      {
        error: "Validation failed",
        details: {
          imageFitHelp: "Choose crop or blur, then retry with imageFit.",
          summary: { errors: [{ message: "Instagram requires JPEG." }] },
        },
      },
      "Failed",
    ),
  ).toBe("Instagram requires JPEG. Choose crop or blur, then retry with imageFit.");
});

it("deduplicates platform messages and safely falls back for malformed responses", () => {
  expect(
    apiResponseError(
      { details: { instagram: { errors: [{ message: "Too many images." }, { message: "Too many images." }] } } },
      "Failed",
    ),
  ).toBe("Too many images.");
  expect(apiResponseError(null, "Try again")).toBe("Try again");
  expect(apiResponseError({ error: "Reconnect Instagram." }, "Failed")).toBe("Reconnect Instagram.");
});
