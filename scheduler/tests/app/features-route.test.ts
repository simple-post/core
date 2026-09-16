import { NextRequest } from "next/server";

import { Feature } from "@prisma/client";

import { GET } from "@/app/api/v1/features/route";
import { getUserFeatures } from "@/lib/features";
import { requireAuth } from "@/lib/middleware/auth";
import { UnauthorizedError } from "@/lib/utils/errors";

jest.mock("@/lib/features", () => ({ getUserFeatures: jest.fn() }));
jest.mock("@/lib/middleware/auth", () => ({ requireAuth: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

it("returns only the authenticated user's grants with no shared caching", async () => {
  jest.mocked(requireAuth).mockResolvedValue({ user: { id: "owner" } } as never);
  jest.mocked(getUserFeatures).mockResolvedValue([Feature.IMAGE_FITTING]);
  const response = await GET(new NextRequest("https://app.test/api/v1/features?userId=other"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ features: ["IMAGE_FITTING"] });
  expect(getUserFeatures).toHaveBeenCalledWith("owner");
});

it("requires authentication before querying grants", async () => {
  jest.mocked(requireAuth).mockRejectedValue(new UnauthorizedError());
  const response = await GET(new NextRequest("https://app.test/api/v1/features"));
  expect(response.status).toBe(401);
  expect(getUserFeatures).not.toHaveBeenCalled();
});
