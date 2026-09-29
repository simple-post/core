import { deleteFromStorage } from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { collectUnusedStorage } from "@/lib/utils/storage-lifecycle";
jest.mock("@simple-post/sdk", () => ({
  deleteFromStorage: jest.fn(),
  getOwnedStorageKeyFromUrl: (url: string, userId: string) =>
    url === `https://storage.test/${userId}/image` ? `${userId}/image` : undefined,
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    postEditorSession: { deleteMany: jest.fn(), findMany: jest.fn() },
    post: { findMany: jest.fn() },
    storageDeletion: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/billing/subscriptions", () => ({ lockUserForQuota: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (callback: unknown) => (callback as (tx: unknown) => Promise<unknown>)(prisma) as never);
  jest.mocked(prisma.storageDeletion.findMany).mockResolvedValue([{ key: "owner/image", userId: "owner" }] as never);
  jest.mocked(prisma.storageDeletion.findUnique).mockResolvedValue({ state: "queued" } as never);
  jest.mocked(prisma.post.findMany).mockResolvedValue([]);
});
it("retains media referenced by an unexpired working copy or AI proposal", async () => {
  jest
    .mocked(prisma.postEditorSession.findMany)
    .mockResolvedValue([
      { payload: {}, proposal: { patch: { media: [{ url: "https://storage.test/owner/image" }] } } },
    ] as never);
  await collectUnusedStorage();
  expect(deleteFromStorage).not.toHaveBeenCalled();
  expect(prisma.storageDeletion.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { dueAt: expect.any(Date) } }),
  );
});
it("collects an unreferenced upload after scratch retention expires", async () => {
  jest.mocked(prisma.postEditorSession.findMany).mockResolvedValue([]);
  await collectUnusedStorage();
  expect(prisma.postEditorSession.deleteMany).toHaveBeenCalled();
  expect(deleteFromStorage).toHaveBeenCalledWith("owner/image", expect.any(Object));
});
