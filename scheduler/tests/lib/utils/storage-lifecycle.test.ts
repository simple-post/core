import { deleteFromStorage } from "@simple-post/sdk";

import { prisma } from "@/lib/prisma";
import { collectUnusedStorage, queueStorageDeletion } from "@/lib/utils/storage-lifecycle";

const now = new Date("2026-11-18T08:00:00.000Z");
const nextWeek = new Date("2026-11-25T08:00:00.000Z");

jest.mock("@simple-post/sdk", () => ({
  deleteFromStorage: jest.fn(),
  getOwnedStorageKeyFromUrl: (url: string, userId: string) =>
    url === `https://storage.test/${userId}/image` ? `${userId}/image` : undefined,
}));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    postEditorSession: { deleteMany: jest.fn(), findMany: jest.fn() },
    post: { findMany: jest.fn() },
    storageDeletion: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/billing/subscriptions", () => ({ lockUserForQuota: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now });
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (callback: unknown) => (callback as (tx: unknown) => Promise<unknown>)(prisma) as never);
  jest.mocked(prisma.storageDeletion.findMany).mockResolvedValue([{ key: "owner/image", userId: "owner" }] as never);
  jest.mocked(prisma.storageDeletion.findUnique).mockResolvedValue({ state: "queued", dueAt: now } as never);
  jest.mocked(prisma.post.findMany).mockResolvedValue([]);
});
afterEach(() => jest.useRealTimers());

it("queues an unreferenced upload for collection after seven days", async () => {
  await queueStorageDeletion(prisma, "owner", "https://storage.test/owner/image");
  expect(prisma.storageDeletion.upsert).toHaveBeenCalledWith({
    where: { key: "owner/image" },
    create: { key: "owner/image", userId: "owner", dueAt: nextWeek },
    update: {},
  });
});

it("retains media referenced by an unexpired working copy or AI proposal", async () => {
  jest
    .mocked(prisma.postEditorSession.findMany)
    .mockResolvedValue([
      { payload: {}, proposal: { patch: { media: [{ url: "https://storage.test/owner/image" }] } } },
    ] as never);
  await collectUnusedStorage();
  expect(deleteFromStorage).not.toHaveBeenCalled();
  expect(prisma.storageDeletion.update).toHaveBeenCalledWith(expect.objectContaining({ data: { dueAt: nextWeek } }));
});

it("skips an upload whose cleanup deadline was extended after the sweep selected it", async () => {
  jest.mocked(prisma.storageDeletion.findUnique).mockResolvedValue({ state: "queued", dueAt: nextWeek } as never);
  await collectUnusedStorage();
  expect(prisma.post.findMany).not.toHaveBeenCalled();
  expect(deleteFromStorage).not.toHaveBeenCalled();
});
it("collects an unreferenced upload after scratch retention expires", async () => {
  jest.mocked(prisma.postEditorSession.findMany).mockResolvedValue([]);
  await collectUnusedStorage();
  expect(prisma.postEditorSession.deleteMany).toHaveBeenCalled();
  expect(deleteFromStorage).toHaveBeenCalledWith("owner/image", expect.any(Object));
});
