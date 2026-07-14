import { NextRequest } from "next/server";

import { POST } from "@/app/api/connect/forem/route";
import { requireAuth } from "@/lib/middleware/auth";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { fetchForem } from "@/lib/security/forem";

jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));
jest.mock("@/lib/oauth/upsert", () => ({ upsertConnectedAccount: jest.fn() }));
jest.mock("@/lib/security/forem", () => {
  const actual = jest.requireActual("@/lib/security/forem");
  return { ...actual, fetchForem: jest.fn() };
});

const requireAuthMock = requireAuth as jest.MockedFunction<typeof requireAuth>;
const upsertMock = upsertConnectedAccount as jest.MockedFunction<typeof upsertConnectedAccount>;
const fetchForemMock = fetchForem as jest.MockedFunction<typeof fetchForem>;

function request(body: unknown): NextRequest {
  return new NextRequest("https://simplepost.example/api/connect/forem", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  requireAuthMock.mockResolvedValue({ user: { id: "user-1" } } as Awaited<ReturnType<typeof requireAuth>>);
});

it("validates a DEV key and stores the normalized account", async () => {
  fetchForemMock.mockResolvedValue(
    new Response(JSON.stringify({ id: 42, username: "vlad", name: "Vladimir", profile_image: null }), {
      status: 200,
    }),
  );

  const response = await POST(request({ instanceUrl: "https://dev.to/", apiKey: "secret" }));

  expect(response.status).toBe(200);
  expect(fetchForemMock).toHaveBeenCalledWith(
    "https://dev.to",
    "/api/users/me",
    expect.objectContaining({ headers: expect.objectContaining({ "api-key": "secret" }) }),
  );
  expect(upsertMock).toHaveBeenCalledWith(
    expect.objectContaining({ platformAccountId: "https://dev.to#42", accessToken: "secret", username: "vlad" }),
  );
});

it("rejects private instance URLs before making a request", async () => {
  const response = await POST(request({ instanceUrl: "https://169.254.169.254", apiKey: "secret" }));

  expect(response.status).toBe(400);
  expect(fetchForemMock).not.toHaveBeenCalled();
  expect(upsertMock).not.toHaveBeenCalled();
});

it("returns a clear error when the instance cannot be reached", async () => {
  fetchForemMock.mockRejectedValue(new Error("network down"));

  const response = await POST(request({ instanceUrl: "https://community.example", apiKey: "secret" }));

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toEqual(
    expect.objectContaining({ error: "Could not reach the Forem instance" }),
  );
});
