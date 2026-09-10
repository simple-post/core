import { Feature } from "@prisma/client";

import { hasFeature, getUserFeatures, requireImageFitting } from "@/lib/features";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({
  prisma: { userFeature: { findUnique: jest.fn(), findMany: jest.fn() } },
}));

beforeEach(() => jest.resetAllMocks());

it("defaults to disabled and scopes lookup to the user and enum", async () => {
  jest.mocked(prisma.userFeature.findUnique).mockResolvedValue(null);
  expect(await hasFeature("user-a", Feature.IMAGE_FITTING)).toBe(false);
  expect(prisma.userFeature.findUnique).toHaveBeenCalledWith({
    where: { userId_feature: { userId: "user-a", feature: Feature.IMAGE_FITTING } },
    select: { userId: true },
  });
});

it("rechecks grants so revocation takes effect on the next call", async () => {
  jest
    .mocked(prisma.userFeature.findUnique)
    .mockResolvedValueOnce({ userId: "user-a" } as never)
    .mockResolvedValueOnce(null);
  await expect(requireImageFitting("user-a")).resolves.toBeUndefined();
  await expect(requireImageFitting("user-a")).rejects.toMatchObject({ statusCode: 403 });
});

it("does not grant access on database failures", async () => {
  jest.mocked(prisma.userFeature.findUnique).mockRejectedValue(new Error("DB unavailable"));
  await expect(requireImageFitting("user-a")).rejects.toThrow("DB unavailable");
});

it("lists only grants belonging to the authenticated user", async () => {
  jest.mocked(prisma.userFeature.findMany).mockResolvedValue([{ feature: Feature.IMAGE_FITTING }] as never);
  expect(await getUserFeatures("user-a")).toEqual([Feature.IMAGE_FITTING]);
  expect(prisma.userFeature.findMany).toHaveBeenCalledWith({
    where: { userId: "user-a" },
    select: { feature: true },
  });
});
