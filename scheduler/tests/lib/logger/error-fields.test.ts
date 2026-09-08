import { flatErrorFields } from "@/lib/logger/error-fields";

it("exports flat exception diagnostics without copying credentials or request objects", () => {
  const error = Object.assign(new Error("GET https://files.example/image?token=secret failed: Bearer private"), {
    code: "INVALID_MEDIA",
    config: { headers: { authorization: "hidden" } },
  });
  const fields = flatErrorFields(error);
  expect(fields.errorType).toBe("Error");
  expect(fields.errorCode).toBe("INVALID_MEDIA");
  expect(fields.errorMessage).toBe("GET https://files.example/image?[REDACTED] failed: Bearer [REDACTED]");
  expect(fields.errorStack).toContain("Error:");
  expect(JSON.stringify(fields)).not.toMatch(/secret|private|hidden/);
  expect(fields).not.toHaveProperty("config");
});

it("handles Pino-serialized errors and limits diagnostic size", () => {
  expect(flatErrorFields({ type: "Error", message: "a".repeat(8000) })).toEqual({
    errorType: "Error",
    errorMessage: "a".repeat(4000),
  });
});
