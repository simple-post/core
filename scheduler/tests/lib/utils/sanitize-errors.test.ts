import { sanitizeForJson } from "@/lib/utils/errors";

it("removes Axios request credentials from error details before logging or storage", () => {
  const error = Object.assign(new Error("Request failed"), {
    config: { headers: { Authorization: "Bearer private-token" }, data: "private request" },
    response: {
      status: 403,
      data: { error: { code: "forbidden", message: "Not allowed", access_token: "private-token" } },
    },
    toJSON: () => ({ leaked: "private-token" }),
  });
  const result = sanitizeForJson({ details: error });
  expect(result).toMatchObject({
    details: { message: "Request failed", response: { status: 403, data: { error: { code: "forbidden" } } } },
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(JSON.stringify(result)).not.toContain("private request");
});
it("handles cycles, repeated references, dates and bigint without failing the error handler", () => {
  const cycle: unknown[] = [];
  cycle.push(cycle);
  const shared = { ok: true };
  expect(
    sanitizeForJson({ cycle, shared, again: shared, date: new Date("2026-09-05T00:00:00Z"), id: BigInt(1) }),
  ).toEqual({
    cycle: ["[Circular]"],
    shared,
    again: shared,
    date: "2026-09-05T00:00:00.000Z",
    id: "1",
  });
});
it("redacts bearer credentials and credentials embedded in URLs", () => {
  const result = sanitizeForJson({
    Authorization: "secret",
    nested: { client_secret: "secret" },
    message:
      "Bearer private-token https://example.com/?access_token=private-token&code=403 https://api.telegram.org/bot123:private-token/sendMessage",
  });
  expect(JSON.stringify(result)).not.toContain("private-token");
  expect(JSON.stringify(result)).not.toContain('"secret"');
});

it("normalizes non-finite values for Prisma JSON storage", () => {
  expect(sanitizeForJson({ n: Number.NaN, infinity: Infinity, valid: 12 })).toEqual({
    n: null,
    infinity: null,
    valid: 12,
  });
});
