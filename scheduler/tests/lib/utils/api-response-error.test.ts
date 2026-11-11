import {
  apiResponseError,
  ApiResponseError,
  isScheduledTimeError,
  isTrialSubmissionError,
} from "@/lib/utils/api-response-error";

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

it("routes scheduling and trial UI by machine reasons instead of translated prose", () => {
  const schedule = new ApiResponseError(
    { error: "LOCALE_MESSAGE", code: "BAD_REQUEST", reason: "INVALID_SCHEDULED_TIME" },
    "Fallback",
    400,
  );
  expect(schedule.message).toBe("LOCALE_MESSAGE");
  expect(schedule.code).toBe("BAD_REQUEST");
  expect(isScheduledTimeError(schedule)).toBe(true);
  expect(isTrialSubmissionError(schedule)).toBe(false);
  for (const reason of ["TRIAL_ALLOWANCE", "TRIAL_EXPIRED"]) {
    expect(isTrialSubmissionError(new ApiResponseError({ error: "LOCALE_MESSAGE", reason }, "Fallback", 403))).toBe(
      true,
    );
  }
  expect(isScheduledTimeError(new Error("scheduled"))).toBe(false);
  expect(
    isTrialSubmissionError(new ApiResponseError({ error: "free trial", code: "FORBIDDEN" }, "Fallback", 403)),
  ).toBe(false);
  expect(new ApiResponseError({ code: {}, reason: 2 }, "Fallback", 400).reason).toBeUndefined();
});
