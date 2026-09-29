import { post as sdkPost } from "@simple-post/sdk";

import { PostsModel } from "@/lib/db";
import { commitEditor, proposeEdit, readEditor, startEditor, updateEditor } from "@/lib/mcp/extensions/workspace";
import { updatePublishingPreferences } from "@/lib/preferences/publishing";
import { prisma } from "@/lib/prisma";

jest.mock("@simple-post/sdk", () => ({ ...jest.requireActual("@simple-post/sdk"), post: jest.fn() }));
jest.mock("@/lib/security/connected-account-secrets", () => ({
  ...jest.requireActual("@/lib/security/connected-account-secrets"),
  decryptConnectedAccountSecrets: (account: unknown) => account,
}));
const userId = "extensions-review-user";
beforeEach(async () => {
  jest.clearAllMocks();
  await prisma.publishCheckpoint.deleteMany();
  await prisma.publishAttempt.deleteMany();
  await prisma.storageDeletion.deleteMany();
  await prisma.user.deleteMany();
  await prisma.user.create({
    data: {
      id: userId,
      name: "Extensions review",
      email: "extensions-review@example.com",
      freeTrial: { create: { expiresAt: new Date(Date.now() + 86_400_000) } },
    },
  });
  await prisma.connectedAccount.create({
    data: { id: "account", userId, platform: "x", platformAccountId: "test", accessToken: "unused" },
  });
});
afterAll(async () => {
  await prisma.$disconnect();
});
it("persists timezone defaults and creates a scratch copy without queueing a post", async () => {
  await updatePublishingPreferences(userId, {
    timeZone: "Europe/Berlin",
    calendarView: "month",
    defaultAccountIds: ["account"],
  });
  const editor = await startEditor(userId);
  expect(editor.content.accountIds).toEqual(["account"]);
  expect(editor.status).toBe("new");
  expect(await prisma.post.count()).toBe(0);
  expect(sdkPost).not.toHaveBeenCalled();
});
it("serializes simultaneous updates so exactly one writer advances the revision", async () => {
  const editor = await startEditor(userId);
  const updates = await Promise.allSettled(
    ["First", "Second"].map((message) =>
      updateEditor(userId, {
        sessionId: editor.sessionId,
        expectedRevision: 0,
        content: { ...editor.content, message },
      }),
    ),
  );
  expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1);
  const saved = await readEditor(userId, editor.sessionId);
  expect(saved.revision).toBe(1);
  expect(["First", "Second"]).toContain(saved.content.message);
  expect(await prisma.post.count()).toBe(0);
});
it("preserves nested media and destination options in persistent working copies", async () => {
  const editor = await startEditor(userId);
  const media = {
    id: "file",
    type: "image" as const,
    url: "https://example.com/image.png",
    filename: "image.png",
    size: 100,
  };
  const content = {
    ...editor.content,
    accountIds: ["account"],
    message: "Shared",
    thread: [{ message: "Reply", media: [media] }],
    accountOverrides: { account: { message: "Custom", thread: [{ message: "Custom reply", media: [media] }] } },
    accountOptions: { account: { customOption: "retained" } },
  };
  const next = await updateEditor(userId, { sessionId: editor.sessionId, expectedRevision: 0, content });
  const recovered = await readEditor(userId, editor.sessionId);
  expect(recovered.content).toEqual(content);
  await proposeEdit(userId, {
    sessionId: editor.sessionId,
    expectedRevision: next.revision,
    patch: { message: "Suggested" },
    explanation: "Shorter",
  });
  const proposed = await readEditor(userId, editor.sessionId);
  expect(proposed.content).toEqual(content);
  expect(proposed.revision).toBe(next.revision);
  expect(proposed.proposal).toMatchObject({ patch: { message: "Suggested" } });
});
it("creates one draft and replays the receipt without creating another post", async () => {
  const editor = await startEditor(userId);
  const next = await updateEditor(userId, {
    sessionId: editor.sessionId,
    expectedRevision: 0,
    content: {
      ...editor.content,
      accountIds: ["account"],
      message: "Save once",
      plannedSchedule: { localTime: "2099-01-01T12:00", timeZone: "Europe/Berlin" },
    },
  });
  const input = { sessionId: editor.sessionId, expectedRevision: next.revision, mode: "draft" as const };
  const first = await commitEditor(userId, input);
  const replay = await commitEditor(userId, input);
  expect(replay).toEqual(first);
  expect(await prisma.post.count()).toBe(1);
  const saved = await prisma.post.findFirstOrThrow();
  expect(saved.status).toBe("draft");
  expect(saved.message).toBe("Save once");
  const recovered = await readEditor(userId, editor.sessionId);
  expect(recovered.content.plannedSchedule).toEqual({ localTime: "2099-01-01T12:00", timeZone: "Europe/Berlin" });
  expect(sdkPost).not.toHaveBeenCalled();
});
it("leaves an existing scheduled post untouched while its working copy autosaves", async () => {
  const post = await new PostsModel(userId).createPost(
    {
      message: "Scheduled text",
      accountIds: ["account"],
      media: [],
      status: "scheduled",
      scheduledFor: new Date(Date.now() + 86_400_000),
    },
    userId,
  );
  const editor = await startEditor(userId, post.id);
  await updateEditor(userId, {
    sessionId: editor.sessionId,
    expectedRevision: 0,
    content: { ...editor.content, message: "Local revision" },
  });
  const saved = await new PostsModel(userId).getPostById(post.id);
  expect(saved?.message).toBe("Scheduled text");
  expect(saved?.scheduledFor).toEqual(post.scheduledFor);
  expect(saved?.updatedAt).toEqual(post.updatedAt);
});
it("rejects expired and foreign working copies", async () => {
  const editor = await startEditor(userId);
  await expect(readEditor("other-user", editor.sessionId)).rejects.toThrow("unavailable");
  await prisma.postEditorSession.update({ where: { id: editor.sessionId }, data: { expiresAt: new Date(0) } });
  await expect(readEditor(userId, editor.sessionId)).rejects.toThrow("expired");
});
