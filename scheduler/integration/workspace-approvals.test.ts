/* eslint-disable unicorn/no-await-expression-member -- Integration assertions inspect committed database values. */
import { uploadFromBuffer, deleteFromStorage } from "@simple-post/sdk";

import { workspaceLimit } from "@/lib/billing/plans";
import { PostsModel } from "@/lib/db";
import { prisma } from "@/lib/prisma";
import { collectUnusedStorage } from "@/lib/utils/storage-lifecycle";
import { acceptInvite, createWorkspace, readWorkspace } from "@/lib/workspaces/access";
import { commandSchema, type Actor } from "@/lib/workspaces/contracts";
import { readFile, saveFile } from "@/lib/workspaces/files";
import { runCommand } from "@/lib/workspaces/posts";
import { release } from "@/lib/workspaces/release";

jest.mock("@simple-post/sdk", () => ({
  ...jest.requireActual("@simple-post/sdk"),
  uploadFromBuffer: jest.fn(),
  deleteFromStorage: jest.fn(),
  hydrateRemoteMediaSizesForAccounts: jest.fn(async () => []),
  validatePostReadiness: jest.fn(async () => []),
}));

function actor(id: string): Actor {
  return { id: "team-test-" + id, name: id, email: id + "@teams.example.invalid", emailVerified: true };
}
const admin = actor("admin"),
  editor = actor("editor"),
  viewer = actor("viewer"),
  other = actor("other");
const people = [admin, editor, viewer, other];
const newTeam = { name: "Editorial", icon: "E", description: "" };
const fields = {
  title: "Launch",
  plannedAt: "2035-01-01T12:00:00.000Z",
  ownerId: null,
  dueAt: null,
  variants: [{ platform: "linkedin", accountId: null, caption: "Ready", fileIds: [], options: {} }],
};
let wid: string;
function send(who: Actor, cmd: unknown) {
  const parsed = commandSchema.parse(cmd);
  if (parsed.action === "release") return release(who, wid, parsed.postId, parsed.reviewId);
  return runCommand(who, wid, parsed);
}
async function clean() {
  await prisma.post.deleteMany({ where: { userId: { in: people.map((p) => p.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: people.map((p) => p.id) } } });
}
beforeEach(async () => {
  delete process.env.SELF_HOSTED;
  await clean();
  await prisma.user.createMany({ data: people });
  await prisma.complimentaryAccess.create({
    data: { userId: admin.id, planKey: "advanced", expiresAt: new Date("2040-01-01") },
  });
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});
async function setup() {
  wid = (await createWorkspace(admin, newTeam)).id;
  for (const [user, role, approver] of [
    [editor, "Editor", false],
    [viewer, "Viewer", true],
  ] as const) {
    await send(admin, { action: "invite", email: user.email, role, approver });
    const inv = await prisma.teamInvite.findFirstOrThrow({ where: { workspaceId: wid, email: user.email } });
    await expect(acceptInvite(other, wid, inv.id)).rejects.toThrow();
    await expect(acceptInvite({ ...user, emailVerified: false }, wid, inv.id)).rejects.toThrow();
    await acceptInvite(user, wid, inv.id);
    await expect(acceptInvite(user, wid, inv.id)).rejects.toThrow();
  }
  await send(editor, { action: "createPost", ...fields });
  return prisma.teamPost.findFirstOrThrow({ where: { workspaceId: wid } });
}
it("serializes creator quotas for each entitlement", async () => {
  expect([workspaceLimit("trial"), workspaceLimit("basic"), workspaceLimit("advanced"), workspaceLimit("pro")]).toEqual(
    [0, 0, 1, 3],
  );
  expect(
    (await Promise.allSettled(Array.from({ length: 4 }, () => createWorkspace(admin, newTeam)))).filter(
      (r) => r.status === "fulfilled",
    ),
  ).toHaveLength(1);
  await prisma.complimentaryAccess.update({ where: { userId: admin.id }, data: { planKey: "pro" } });
  expect(
    (await Promise.allSettled(Array.from({ length: 4 }, () => createWorkspace(admin, newTeam)))).filter(
      (r) => r.status === "fulfilled",
    ),
  ).toHaveLength(2);
  await expect(createWorkspace(other, newTeam)).rejects.toThrow();
});
it("enforces membership, private media, state constraints and Viewer plus Approver permissions", async () => {
  const post = await setup();
  const ws = await readWorkspace(viewer, wid);
  expect(ws.posts).toHaveLength(1);
  expect(ws.states.at(-1)?.kind).toBe("approved");
  await expect(readWorkspace(other, wid)).rejects.toThrow();
  await expect(send(other, { action: "comment", postId: post.id, body: "Hi" })).rejects.toThrow();
  await send(viewer, { action: "comment", postId: post.id, body: "Please check the date" });
  await expect(send(viewer, { action: "edit", ...fields, postId: post.id, revision: 1 })).rejects.toThrow();
  await expect(send(editor, { action: "remove", userId: viewer.id })).rejects.toThrow();
  await expect(send(admin, { action: "deleteState", stateId: ws.states.at(-1)!.id })).rejects.toThrow();
  await expect(send(admin, { action: "state", name: "approved", position: 12 })).rejects.toThrow();
  await expect(
    send(editor, { action: "move", postId: post.id, revision: 1, stateId: ws.states.at(-1)!.id }),
  ).rejects.toThrow();
  await send(admin, { action: "state", name: "Design ready", position: 20 });
  const file = await saveFile(editor, wid, "cover.png", Buffer.from("89504e470d0a1a0a", "hex"));
  await expect(readFile(viewer, wid, file.id)).resolves.toMatchObject({ id: file.id });
  await expect(readFile(other, wid, file.id)).rejects.toThrow();
  await expect(saveFile(viewer, wid, "another.png", Buffer.from("89504e470d0a1a0a", "hex"))).rejects.toThrow();
  const another = (
    await prisma.teamWorkspace.create({
      data: {
        ...newTeam,
        creatorId: other.id,
        members: { create: { userId: other.id, role: "Admin", approver: true } },
      },
    })
  ).id;
  await expect(runCommand(other, another, { action: "comment", postId: post.id, body: "outside" })).rejects.toThrow();
  await expect(readFile(other, another, file.id)).rejects.toThrow();
});
it("pins decisions to snapshots, handles retries and preserves resubmission history", async () => {
  const { id: postId } = await setup();
  const get = () => prisma.teamPost.findUniqueOrThrow({ where: { id: postId } });
  const submit = async () => {
    const { revision } = await get();
    const cmd = { action: "submit", postId, revision };
    await Promise.all([send(editor, cmd), send(editor, cmd)]);
    return (await get()).currentReviewId!;
  };
  const edit = async (caption: string, ownerId: string | null = null) =>
    send(editor, {
      ...fields,
      variants: [{ ...fields.variants[0], caption }],
      action: "edit",
      postId,
      revision: (await get()).revision,
      ownerId,
    });
  const decide = (reviewId: string, outcome: string) =>
    send(viewer, { action: "decide", postId, reviewId, outcome, body: "Check framing" });
  const first = await submit();
  await expect(release(admin, wid, postId, first)).rejects.toThrow();
  await edit("Updated");
  await expect(decide(first, "approved")).rejects.toThrow();
  const second = await submit();
  await expect(
    send(editor, { action: "decide", postId, reviewId: second, outcome: "approved", body: "" }),
  ).rejects.toThrow();
  await Promise.all([decide(second, "changes"), decide(second, "changes")]);
  const afterChanges = await get();
  expect((await prisma.teamState.findUniqueOrThrow({ where: { id: afterChanges.stateId } })).kind).toBe("progress");
  const third = await submit();
  await send(admin, { action: "member", userId: viewer.id, role: "Viewer", approver: false });
  await expect(decide(third, "approved")).rejects.toThrow();
  await expect(send(viewer, { action: "comment", postId, body: "Read only" })).rejects.toThrow();
  await send(admin, { action: "member", userId: viewer.id, role: "Viewer", approver: true });
  await Promise.all([decide(third, "approved"), decide(third, "approved")]);
  await edit("Updated", editor.id);
  expect((await get()).currentReviewId).toBe(third);
  await edit("Final");
  await expect(release(admin, wid, postId, third)).rejects.toThrow();
  const last = await submit();
  await decide(last, "approved");
  await Promise.all([release(editor, wid, postId, last), release(editor, wid, postId, last)]);
  expect(await prisma.teamReview.count({ where: { postId } })).toBe(4);
  expect(await prisma.teamEvent.count({ where: { postId, kind: "published natively" } })).toBe(1);
  expect(await prisma.post.count({ where: { userId: admin.id } })).toBe(0);
  expect((await prisma.teamReview.findUniqueOrThrow({ where: { id: first } })).snapshot).toMatchObject({
    variants: [{ caption: "Ready" }],
  });
});
it("queues only an approved connected snapshot once, leaving personal editing and calendars intact", async () => {
  const { id: postId } = await setup();
  const account = await prisma.connectedAccount.create({
    data: {
      userId: admin.id,
      platform: "linkedin",
      platformAccountId: "launch-brand",
      accessToken: "fixture",
      displayName: "Launch brand",
    },
  });
  await send(admin, {
    action: "edit",
    postId,
    revision: 1,
    ...fields,
    variants: [{ ...fields.variants[0], accountId: account.id }],
  });
  await send(editor, { action: "submit", revision: 2, postId });
  const reviewId = (await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } })).currentReviewId!;
  await send(viewer, { action: "decide", postId, reviewId, outcome: "approved", body: "" });
  await expect(release(editor, wid, postId, reviewId)).rejects.toThrow();
  expect(await prisma.post.count({ where: { userId: admin.id } })).toBe(0);
  await Promise.all([release(admin, wid, postId, reviewId), release(admin, wid, postId, reviewId)]);
  const deliveries = await prisma.post.findMany({ where: { workspaceReviewId: reviewId } });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({ message: "Ready", status: "scheduled" });
  const repo = new PostsModel(admin.id);
  await expect(
    repo.updatePost(
      deliveries[0].id,
      { message: "changed" },
      { updatedAt: deliveries[0].updatedAt, status: "scheduled" },
    ),
  ).rejects.toThrow();
  await expect(repo.updatePost(deliveries[0].id, { message: "Unversioned edit" })).rejects.toThrow();
  const personal = await repo.createPost(
    { message: "Personal", status: "scheduled", scheduledFor: new Date(fields.plannedAt), media: [], accountIds: [] },
    admin.id,
  );
  await expect(
    repo.updatePost(personal.id, { message: "Edited" }, { updatedAt: personal.updatedAt, status: "scheduled" }),
  ).resolves.toMatchObject({ message: "Edited" });
  expect(await repo.getPostsBetween(new Date("2035-01-01"), new Date("2035-01-02"))).toHaveLength(2);
});

it("serializes a decision racing a content edit and retains the exact submitted media", async () => {
  const { id: postId } = await setup();
  const file = await saveFile(editor, wid, "review.png", Buffer.from("89504e470d0a1a0a", "hex"));
  await send(editor, {
    action: "edit",
    ...fields,
    variants: [{ ...fields.variants[0], fileIds: [file.id] }],
    postId,
    revision: 1,
  });
  await send(editor, { action: "submit", postId, revision: 2 });
  const open = await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } });
  const attempts = await Promise.allSettled([
    send(editor, { action: "edit", ...fields, postId, revision: open.revision }),
    send(viewer, { action: "decide", postId, reviewId: open.currentReviewId, outcome: "approved", body: "" }),
  ]);
  expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const review = await prisma.teamReview.findUniqueOrThrow({ where: { id: open.currentReviewId! } });
  expect(review.snapshot).toMatchObject({ variants: [{ fileIds: [file.id] }] });
  await expect(send(admin, { action: "removeFile", fileId: file.id })).rejects.toThrow("retained review");
  const saved = await prisma.teamPost.findUniqueOrThrow({ where: { id: postId }, include: { state: true } });
  if (saved.state.kind === "approved") {
    expect(saved.variants).toMatchObject([{ fileIds: [file.id] }]);
  } else {
    expect(saved.currentReviewId).toBeNull();
    await expect(release(admin, wid, postId, review.id)).rejects.toThrow();
  }
  await send(admin, { action: "remove", userId: viewer.id });
  await expect(readFile(viewer, wid, file.id)).rejects.toThrow();
  expect(await readFile(admin, wid, file.id)).toMatchObject({ id: file.id });
});

it("retains a shared approved file across two connected deliveries and audits cancellation", async () => {
  const { id: postId } = await setup();
  const previousBase = process.env.S3_STORAGE_BASE_URL;
  process.env.S3_STORAGE_BASE_URL = "https://media.example.invalid";
  try {
    jest.mocked(uploadFromBuffer).mockImplementation(async (_bytes, key) => "https://media.example.invalid/" + key);
    const file = await saveFile(editor, wid, "launch.jpg", Buffer.from("ffd8ffe0", "hex"));
    const unused = await saveFile(editor, wid, "unused.jpg", Buffer.from("ffd8ffe0", "hex"));
    await send(admin, { action: "removeFile", fileId: unused.id });
    await expect(readFile(admin, wid, unused.id)).rejects.toThrow();
    const variants = [];
    for (const platform of ["instagram", "linkedin"]) {
      const account = await prisma.connectedAccount.create({
        data: { userId: admin.id, platform, platformAccountId: platform + "-studio", accessToken: "fixture" },
      });
      variants.push({ ...fields.variants[0], platform, accountId: account.id, fileIds: [file.id] });
    }
    await send(admin, { action: "edit", postId, revision: 1, ...fields, variants });
    await send(editor, { action: "submit", postId, revision: 2 });
    const reviewId = (await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } })).currentReviewId!;
    await send(viewer, { action: "decide", postId, reviewId, outcome: "approved", body: "" });
    await release(admin, wid, postId, reviewId);
    const deliveries = await prisma.post.findMany({ where: { workspaceReviewId: reviewId }, include: { media: true } });
    expect(deliveries).toHaveLength(2);
    expect(uploadFromBuffer).toHaveBeenCalledTimes(1);
    expect(deliveries[0].media[0].url).toBe(deliveries[1].media[0].url);
    expect(deliveries[0].media[0].id).not.toBe(deliveries[1].media[0].id);
    await prisma.storageDeletion.updateMany({ where: { userId: admin.id }, data: { dueAt: new Date(0) } });
    await collectUnusedStorage();
    expect(deleteFromStorage).not.toHaveBeenCalled();
    await new PostsModel(admin.id).deletePost(deliveries[0].id, deliveries[0].updatedAt);
    expect(await prisma.teamEvent.count({ where: { postId, reviewId, kind: "delivery removed" } })).toBe(1);
    // Owner erasure cascades to originals, reviews and remaining deliveries in one statement.
    await prisma.user.delete({ where: { id: admin.id } });
    expect(await prisma.teamReview.count({ where: { id: reviewId } })).toBe(0);
    expect(await prisma.teamFile.count({ where: { id: file.id } })).toBe(0);
  } finally {
    if (previousBase === undefined) delete process.env.S3_STORAGE_BASE_URL;
    else process.env.S3_STORAGE_BASE_URL = previousBase;
  }
});
