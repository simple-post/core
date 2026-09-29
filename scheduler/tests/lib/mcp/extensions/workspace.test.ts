import { commitEditor, proposeEdit, readEditor, updateEditor } from "@/lib/mcp/extensions/workspace";
import { executePostUpdate } from "@/lib/posting/update-post";
import { prisma } from "@/lib/prisma";

const getPost = jest.fn();
jest.mock("@/lib/db", () => ({ PostsModel: jest.fn().mockImplementation(() => ({ getPostById: getPost })) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    postEditorSession: { findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    $transaction: jest.fn(),
  },
}));
jest.mock("@/lib/billing/subscriptions", () => ({ lockUserForQuota: jest.fn() }));
jest.mock("@/lib/utils/storage-lifecycle", () => ({
  assertStorageAvailable: jest.fn(),
  queueStorageDeletion: jest.fn(),
}));
jest.mock("@/lib/posting/update-post", () => ({ executePostUpdate: jest.fn() }));
jest.mock("@/lib/mcp/tools/posts", () => ({ createPost: jest.fn(), inspectPosts: jest.fn() }));
jest.mock("@/lib/mcp/tools/accounts", () => ({ listAccounts: jest.fn() }));
jest.mock("@/lib/mcp/tools/schedule", () => ({ getSchedule: jest.fn() }));
jest.mock("@/lib/validation/sdk-validation", () => ({ validatePostForAccounts: jest.fn() }));

const content = {
  message: "Draft",
  accountIds: ["a"],
  media: [],
  thread: [],
  accountOptions: {},
  accountOverrides: {},
  quotePostId: null,
};
const stamp = new Date("2026-09-29T12:00:00Z");
const session = {
  id: "session",
  userId: "owner",
  postId: "post",
  baseUpdatedAt: stamp,
  payload: content,
  proposal: null,
  revision: 4,
  committing: false,
  commitMode: null,
  commitRevision: null,
  commitResult: null,
};
const post = { id: "post", ...content, updatedAt: stamp, status: "draft", scheduledFor: null };
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(prisma.$transaction)
    .mockImplementation(async (callback: unknown) => (callback as (tx: unknown) => Promise<unknown>)(prisma) as never);
  jest.mocked(prisma.postEditorSession.findFirst).mockResolvedValue({ ...session } as never);
  jest.mocked(prisma.postEditorSession.updateMany).mockResolvedValue({ count: 1 });
  getPost.mockResolvedValue(post);
});
it("rejects an unavailable or foreign session without reading any saved post", async () => {
  jest.mocked(prisma.postEditorSession.findFirst).mockResolvedValue(null);
  await expect(readEditor("other", "session")).rejects.toThrow("unavailable");
  expect(prisma.postEditorSession.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ userId: "other", expiresAt: { gt: expect.any(Date) } }),
    }),
  );
  expect(getPost).not.toHaveBeenCalled();
});
it("rejects a stale scratch revision instead of overwriting it", async () => {
  jest.mocked(prisma.postEditorSession.updateMany).mockResolvedValue({ count: 0 });
  await expect(updateEditor("owner", { sessionId: "session", expectedRevision: 3, content })).rejects.toThrow(
    "changed",
  );
  expect(executePostUpdate).not.toHaveBeenCalled();
});
it("stores proposals separately without changing content or the revision", async () => {
  await proposeEdit("owner", {
    sessionId: "session",
    expectedRevision: 4,
    patch: { message: "Suggestion" },
    explanation: "Shorter",
  });
  const call = jest.mocked(prisma.postEditorSession.updateMany).mock.calls[0][0];
  expect(call?.data).toEqual({ proposal: { patch: { message: "Suggestion" }, explanation: "Shorter", revision: 4 } });
  expect(executePostUpdate).not.toHaveBeenCalled();
});
it("rejects a changed saved post and preserves the working copy", async () => {
  getPost.mockResolvedValue({ ...post, updatedAt: new Date(stamp.getTime() + 1) });
  await expect(commitEditor("owner", { sessionId: "session", expectedRevision: 4, mode: "draft" })).rejects.toThrow(
    "saved post changed",
  );
  expect(executePostUpdate).not.toHaveBeenCalled();
  expect(prisma.postEditorSession.updateMany).toHaveBeenLastCalledWith(
    expect.objectContaining({ data: { committing: false } }),
  );
});
it("persists the successful commit receipt and revision atomically", async () => {
  jest.mocked(executePostUpdate).mockResolvedValue({ success: true } as never);
  const result = await commitEditor("owner", { sessionId: "session", expectedRevision: 4, mode: "draft" });
  expect(prisma.postEditorSession.update).toHaveBeenCalledTimes(1);
  expect(prisma.postEditorSession.update).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ revision: 5, committing: false, commitResult: result }),
    }),
  );
});
it("replays the previous receipt without a second platform action", async () => {
  const receipt = { editor: { revision: 5 }, outcome: { success: true } };
  jest.mocked(prisma.postEditorSession.findFirst).mockResolvedValue({
    ...session,
    revision: 5,
    commitRevision: 4,
    commitMode: JSON.stringify({ mode: "now" }),
    commitResult: receipt,
  } as never);
  await expect(commitEditor("owner", { sessionId: "session", expectedRevision: 4, mode: "now" })).resolves.toEqual(
    receipt,
  );
  expect(executePostUpdate).not.toHaveBeenCalled();
});
it("keeps the claim when publishing may have reached a platform", async () => {
  getPost.mockResolvedValueOnce(post).mockResolvedValue({ ...post, status: "pending" });
  jest.mocked(executePostUpdate).mockRejectedValue(new Error("Connection lost"));
  await expect(commitEditor("owner", { sessionId: "session", expectedRevision: 4, mode: "now" })).rejects.toThrow(
    "do not retry",
  );
  expect(prisma.postEditorSession.updateMany).toHaveBeenCalledTimes(1);
});
