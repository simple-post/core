import { Prisma } from "@prisma/client";

import { PostsModel } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import { ConflictError } from "@/lib/utils/errors";

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
    post: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

const postMock = jest.mocked(prisma.post);
const snapshotTime = new Date("2026-09-01T10:00:00Z");

function row() {
  return {
    id: "p1",
    userId: "u1",
    message: "original",
    accounts: [],
    media: [],
    status: "scheduled",
    createdAt: snapshotTime,
    updatedAt: snapshotTime,
    scheduledFor: new Date("2026-09-01T11:00:00Z"),
    repostEnabled: false,
    repostDelayHours: 12,
    repostStatus: "not_applicable",
  };
}

function missingRow() {
  return new Prisma.PrismaClientKnownRequestError("Record no longer matches", {
    code: "P2025",
    clientVersion: "6.16.3",
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest
    .mocked(prisma.$transaction)
    .mockImplementation((async (callback: (tx: unknown) => unknown) => callback({ ...prisma })) as never);
});

it("includes overdue scheduled posts in the queue and pagination count", async () => {
  const overdue = row();
  postMock.findMany.mockResolvedValue([overdue] as never);
  postMock.count.mockResolvedValue(1);
  const result = await new PostsModel("u1").getScheduledPosts();
  expect(result.data.map((post) => post.id)).toEqual(["p1"]);
  expect(result.pagination.total).toBe(1);
  expect(postMock.findMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { userId: "u1", status: "scheduled" } }),
  );
  expect(postMock.count).toHaveBeenCalledWith({ where: { userId: "u1", status: "scheduled" } });
});

it.each([
  {
    method: "getScheduledPosts" as const,
    status: "scheduled",
    orderBy: [{ scheduledFor: { sort: "asc", nulls: "last" } }, { id: "asc" }],
  },
  {
    method: "getPastPosts" as const,
    status: "published",
    orderBy: [
      { publishedAt: { sort: "desc", nulls: "last" } },
      { scheduledFor: { sort: "desc", nulls: "last" } },
      { createdAt: "desc" },
      { id: "desc" },
    ],
  },
  {
    method: "getFailedPosts" as const,
    status: "failed",
    orderBy: [{ scheduledFor: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "desc" }],
  },
])("$method orders by the post timestamp before pagination", async ({ method, status, orderBy }) => {
  postMock.findMany.mockResolvedValue([]);
  postMock.count.mockResolvedValue(60);

  const result = await new PostsModel("u1")[method]({ page: 2, limit: 25 });

  expect(postMock.findMany).toHaveBeenCalledWith({
    where: { userId: "u1", status },
    include: { media: true, accounts: true },
    orderBy,
    skip: 25,
    take: 25,
  });
  expect(postMock.count).toHaveBeenCalledWith({ where: { userId: "u1", status } });
  expect(result.pagination).toEqual({
    page: 2,
    limit: 25,
    total: 60,
    totalPages: 3,
    hasNextPage: true,
    hasPreviousPage: true,
  });
});

it.each(["pending", "scheduled"])("rejects an edit when a %s row changed during validation", async (status) => {
  const original = row();
  postMock.findFirst.mockResolvedValue(original as never);
  const repository = new PostsModel("u1");
  const snapshot = (await repository.getPostById("p1"))!;
  const current = { ...original, status, updatedAt: new Date(snapshotTime.getTime() + 1000) };
  postMock.update.mockImplementation((async ({ where }: { where: Prisma.PostWhereUniqueInput }) => {
    if (where.status !== current.status || (where.updatedAt as Date)?.getTime() !== current.updatedAt.getTime()) {
      throw missingRow();
    }
    return current;
  }) as never);

  await expect(
    repository.updatePost(
      "p1",
      { message: "replacement", status: "scheduled" },
      {
        status: snapshot.status,
        updatedAt: snapshot.updatedAt,
      },
    ),
  ).rejects.toBeInstanceOf(ConflictError);
  expect(current.message).toBe("original");
});

it("updates an unchanged snapshot with its ownership and version conditions", async () => {
  const original = row();
  postMock.update.mockResolvedValue({ ...original, message: "replacement" } as never);
  const result = await new PostsModel("u1").updatePost(
    "p1",
    { message: "replacement" },
    { status: "scheduled", updatedAt: snapshotTime },
  );
  expect(result.message).toBe("replacement");
  expect(postMock.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: "p1", userId: "u1", status: "scheduled", updatedAt: snapshotTime },
    }),
  );
});

it("turns a conflicting delete into an actionable conflict and excludes active publishing", async () => {
  postMock.delete.mockRejectedValue(missingRow());
  await expect(new PostsModel("u1").deletePost("p1", snapshotTime)).rejects.toBeInstanceOf(ConflictError);
  expect(postMock.delete).toHaveBeenCalledWith({
    where: {
      id: "p1",
      userId: "u1",
      updatedAt: snapshotTime,
      status: { not: "pending" },
      repostStatus: { not: "pending" },
    },
  });
});

jest.mock("@/lib/billing/subscriptions", () => ({ lockUserForQuota: jest.fn() }));
jest.mock("@/lib/utils/storage-lifecycle", () => ({
  assertStorageAvailable: jest.fn(),
  queueStorageDeletion: jest.fn(),
}));
