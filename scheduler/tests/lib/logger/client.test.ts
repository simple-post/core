import { logClientError } from "@/lib/logger/client";

it("does not let a global diagnostic deduplicate away a blocking boundary alert", () => {
  const fetcher = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
  jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const error = new Error("Page cannot render");
    logClientError(error, "Unhandled browser error");
    logClientError(error, "Boundary failed", { area: "app.error-boundary" });
    logClientError(error, "Boundary failed", { area: "app.error-boundary" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).context.area).toBe("app.error-boundary");
  } finally {
    jest.restoreAllMocks();
  }
});
