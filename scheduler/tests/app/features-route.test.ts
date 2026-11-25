import { NextRequest } from "next/server";

import { Feature } from "@prisma/client";

import { GET } from "@/app/api/v1/features/route";
import { getUserFeatures, hasFeature } from "@/lib/features";
import { requireBrowserSession, requireReadAuth } from "@/lib/middleware/auth";
import { PaymentRequiredError, UnauthorizedError } from "@/lib/utils/errors";

jest.mock("@/lib/features", () => ({ getUserFeatures: jest.fn(), hasFeature: jest.fn() }));
jest.mock("@/lib/middleware/auth", () => ({ requireReadAuth: jest.fn(), requireBrowserSession: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

it("returns only the authenticated user's grants with no shared caching", async () => {
  jest.mocked(requireReadAuth).mockResolvedValue({ user: { id: "owner" } } as never);
  jest.mocked(getUserFeatures).mockResolvedValue([Feature.IMAGE_FITTING]);
  const response = await GET(new NextRequest("https://app.test/api/v1/features?userId=other"));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ features: ["IMAGE_FITTING"] });
  expect(getUserFeatures).toHaveBeenCalledWith("owner");
});

it("requires authentication before querying grants", async () => {
  jest.mocked(requireReadAuth).mockRejectedValue(new UnauthorizedError());
  const response = await GET(new NextRequest("https://app.test/api/v1/features"));
  expect(response.status).toBe(401);
  expect(getUserFeatures).not.toHaveBeenCalled();
});

it.each([true, false])("limits an unpaid browser session to its private pilot grant (granted=%s)", async (granted) => {
  jest.mocked(requireReadAuth).mockRejectedValue(new PaymentRequiredError());
  jest.mocked(requireBrowserSession).mockResolvedValue({ user: { id: "signed-in" } } as never);
  jest.mocked(hasFeature).mockResolvedValue(granted);
  const response = await GET(new NextRequest("https://app.test/api/v1/features"));
  expect(response.status).toBe(granted ? 200 : 402);
  expect(hasFeature).toHaveBeenCalledWith("signed-in", "TEAM_WORKSPACES");
  if (granted) expect(await response.json()).toEqual({ features: ["TEAM_WORKSPACES"] });
  expect(getUserFeatures).not.toHaveBeenCalled();
});

it("preserves billing requirements for bearer credentials", async () => {
  jest.mocked(requireReadAuth).mockRejectedValue(new PaymentRequiredError());
  const response = await GET(
    new NextRequest("https://app.test/api/v1/features", {
      headers: { authorization: "Bearer test" },
    }),
  );
  expect(response.status).toBe(402);
  expect(requireBrowserSession).not.toHaveBeenCalled();
});
