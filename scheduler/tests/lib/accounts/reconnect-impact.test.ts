import { getReconnectImpact } from "@/lib/accounts/reconnect-impact";
import { prisma } from "@/lib/prisma";

jest.mock("@/lib/prisma", () => ({ prisma: { post: { findMany: jest.fn() } } }));
beforeEach(() => jest.clearAllMocks());

it("counts queued targets, skipping successful targets of a partially published post", async () => {
  jest.mocked(prisma.post.findMany).mockResolvedValue([
    { accounts: [{ id: "a" }, { id: "b" }], accountResults: null },
    { accounts: [{ id: "a" }, { id: "b" }], accountResults: { a: { success: true }, b: { success: false } } },
  ] as never);
  expect(await getReconnectImpact("owner", ["a", "b", "c"])).toEqual(
    new Map([
      ["a", 1],
      ["b", 2],
      ["c", 0],
    ]),
  );
  expect(prisma.post.findMany).toHaveBeenCalledWith({
    where: {
      userId: "owner",
      status: { in: ["scheduled", "pending"] },
      accounts: { some: { id: { in: ["a", "b", "c"] } } },
    },
    select: { accounts: { where: { id: { in: ["a", "b", "c"] } }, select: { id: true } }, accountResults: true },
  });
});

it("does not query posts when every connection is healthy", async () => {
  expect(await getReconnectImpact("owner", [])).toEqual(new Map());
  expect(prisma.post.findMany).not.toHaveBeenCalled();
});
