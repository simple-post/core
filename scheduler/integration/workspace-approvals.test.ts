/* eslint-disable unicorn/no-await-expression-member -- Integration assertions inspect committed database values. */
import { uploadFromBuffer, deleteFromStorage, generateFileKey } from "@simple-post/sdk";
import sharp from "sharp";

import { PostsModel } from "@/lib/db";
import { upsertConnectedAccount } from "@/lib/oauth/upsert";
import { listPostAnalytics } from "@/lib/post-analytics/query";
import { ensureAnalyticsRowsForUser } from "@/lib/post-analytics/service";
import { prisma } from "@/lib/prisma";
import { sendNotificationEmail } from "@/lib/resend/notification-email";
import { collectUnusedStorage } from "@/lib/utils/storage-lifecycle";
import { acceptInvite, createWorkspace, readWorkspace } from "@/lib/workspaces/access";
import { workspaceConnections } from "@/lib/workspaces/connections";
import { commandSchema, snapshotSchema, type Actor } from "@/lib/workspaces/contracts";
import { readFile, saveFile } from "@/lib/workspaces/files";
import { deliverWorkspaceInvitation } from "@/lib/workspaces/invitations";
import { normalizeWorkspaceLogo } from "@/lib/workspaces/logo";
import { runCommand } from "@/lib/workspaces/posts";
import { cancelDelivery, release } from "@/lib/workspaces/release";

jest.mock("@/lib/resend/notification-email", () => ({ sendNotificationEmail: jest.fn() }));

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
  if (parsed.action === "cancelDelivery") return cancelDelivery(who, wid, parsed.postId, parsed.deliveryId);
  return runCommand(who, wid, parsed);
}
async function clean() {
  await prisma.post.deleteMany({ where: { userId: { in: people.map((p) => p.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: people.map((p) => p.id) } } });
  await prisma.storageDeletion.deleteMany({ where: { userId: { in: people.map((p) => p.id) } } });
}
beforeEach(async () => {
  delete process.env.SELF_HOSTED;
  await clean();
  await prisma.user.createMany({ data: people });
  await prisma.userFeature.create({ data: { userId: admin.id, feature: "TEAM_WORKSPACES" } });
  await prisma.complimentaryAccess.create({
    data: { userId: admin.id, planKey: "advanced", expiresAt: new Date("2040-01-01") },
  });
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});
function connectWorkspaceAccount() {
  return prisma.connectedAccount.create({
    data: {
      userId: admin.id,
      workspaceId: wid,
      platform: "linkedin",
      platformAccountId: "launch-brand",
      accessToken: "fixture",
      displayName: "Launch brand",
    },
  });
}
async function setup(connected = false) {
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
  const account = connected ? await connectWorkspaceAccount() : null;
  await send(editor, {
    action: "createPost",
    ...fields,
    variants: [{ ...fields.variants[0], accountId: account?.id ?? null }],
  });
  return prisma.teamPost.findFirstOrThrow({ where: { workspaceId: wid } });
}
it("allows only the pilot to create workspaces, independently of billing and invitations", async () => {
  await prisma.complimentaryAccess.delete({ where: { userId: admin.id } });
  const workspace = await createWorkspace(admin, newTeam);
  wid = workspace.id;
  await createWorkspace(admin, newTeam);
  await send(admin, { action: "invite", email: other.email, role: "Editor", approver: false });
  const access = await prisma.complimentaryAccess.create({
    data: { userId: other.id, planKey: "pro", expiresAt: new Date("2040-01-01") },
  });
  await expect(createWorkspace(other, newTeam)).rejects.toMatchObject({ statusCode: 404 });
  expect(await prisma.userFeature.count({ where: { userId: other.id } })).toBe(0);
  expect(await prisma.complimentaryAccess.findUnique({ where: { userId: other.id } })).toEqual(access);
  await prisma.userFeature.deleteMany({ where: { userId: admin.id, feature: "TEAM_WORKSPACES" } });
  await expect(createWorkspace(admin, newTeam)).rejects.toMatchObject({ statusCode: 404 });
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
  const { id: postId } = await setup(true);
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { workspaceId: wid } });
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
      variants: [{ ...fields.variants[0], caption, accountId: account.id }],
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
  await Promise.all([release(admin, wid, postId, last), release(admin, wid, postId, last)]);
  expect(await prisma.teamReview.count({ where: { postId } })).toBe(4);
  expect(await prisma.teamEvent.count({ where: { postId, kind: "scheduled" } })).toBe(1);
  expect(await prisma.post.count({ where: { workspaceReviewId: last } })).toBe(1);
  expect((await prisma.teamReview.findUniqueOrThrow({ where: { id: first } })).snapshot).toMatchObject({
    variants: [{ caption: "Ready" }],
  });
});
it("queues only an approved connected snapshot once, leaving personal editing and calendars intact", async () => {
  const { id: postId } = await setup();
  const account = await connectWorkspaceAccount();
  expect((await readWorkspace(editor, wid)).accounts).toEqual([
    {
      id: account.id,
      platform: "linkedin",
      platformAccountId: "launch-brand",
      displayName: "Launch brand",
      username: null,
    },
  ]);
  await send(editor, {
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
  expect(await repo.getPostsBetween(new Date("2035-01-01"), new Date("2035-01-02"))).toHaveLength(1);
  await expect(repo.getPostById(deliveries[0].id)).resolves.toBeNull();
});

it("serializes a decision racing a content edit and retains the exact submitted media", async () => {
  const { id: postId } = await setup(true);
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { workspaceId: wid } });
  const file = await saveFile(editor, wid, "review.png", Buffer.from("89504e470d0a1a0a", "hex"));
  await send(editor, {
    action: "edit",
    ...fields,
    variants: [{ ...fields.variants[0], accountId: account.id, fileIds: [file.id] }],
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
        data: {
          userId: admin.id,
          workspaceId: wid,
          platform,
          platformAccountId: platform + "-studio",
          accessToken: "fixture",
        },
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
    const sharedKey = jest.mocked(uploadFromBuffer).mock.calls[0][1];
    await prisma.storageDeletion.update({ where: { key: sharedKey }, data: { dueAt: new Date(0) } });
    await collectUnusedStorage();
    expect(jest.mocked(deleteFromStorage).mock.calls.map(([key]) => key)).not.toContain(sharedKey);
    await cancelDelivery(admin, wid, postId, deliveries[0].id);
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

it("stores the same native identity independently in Personal and two workspaces", async () => {
  const first = await createWorkspace(admin, { ...newTeam, name: "First" });
  const second = await createWorkspace(admin, { ...newTeam, name: "Second" });
  const connection = {
    userId: admin.id,
    platform: "instagram",
    platformAccountId: "shared-native",
    accessToken: "initial",
    refreshToken: null,
    expiresAt: null,
    scope: null,
    username: "brand",
    displayName: "Brand",
    email: null,
    profilePicture: null,
  };
  await upsertConnectedAccount(connection);
  await upsertConnectedAccount({ ...connection, workspaceId: first.id });
  const firstAccount = await prisma.connectedAccount.findFirstOrThrow({ where: { workspaceId: first.id } });
  await upsertConnectedAccount({ ...connection, workspaceId: second.id });
  await upsertConnectedAccount({
    ...connection,
    workspaceId: first.id,
    reconnectAccountId: firstAccount.id,
    displayName: "Renamed in First",
  });
  await expect(
    upsertConnectedAccount({ ...connection, workspaceId: second.id, reconnectAccountId: firstAccount.id }),
  ).rejects.toThrow("Choose the same account");
  expect(await prisma.connectedAccount.count({ where: { userId: admin.id } })).toBe(3);
  const firstDetail = await readWorkspace(admin, first.id);
  const secondDetail = await readWorkspace(admin, second.id);
  expect(firstDetail.accounts).toMatchObject([{ id: firstAccount.id, displayName: "Renamed in First" }]);
  expect(secondDetail.accounts).toMatchObject([{ displayName: "Brand" }]);
  await expect(workspaceConnections(other.id, first.id)).rejects.toMatchObject({ statusCode: 404 });
  const personal = await prisma.connectedAccount.findFirstOrThrow({ where: { userId: admin.id, workspaceId: null } });
  await expect(
    runCommand(
      admin,
      first.id,
      commandSchema.parse({
        action: "createPost",
        ...fields,
        variants: [{ ...fields.variants[0], platform: "instagram", accountId: personal.id }],
      }) as Parameters<typeof runCommand>[2],
    ),
  ).rejects.toThrow("Connected destination unavailable");
});

it("allows editors to update a legacy destination without releasing through Personal", async () => {
  const { id: postId } = await setup();
  const account = await prisma.connectedAccount.create({
    data: { userId: admin.id, platform: "linkedin", platformAccountId: "legacy-brand", accessToken: "fixture" },
  });
  const destination = { platformAccountId: account.platformAccountId, label: "Legacy brand" };
  const variant = { ...fields.variants[0], accountId: account.id };
  await prisma.teamPost.update({ where: { id: postId }, data: { variants: [{ ...variant, destination }] } });

  await send(editor, {
    action: "edit",
    postId,
    revision: 1,
    ...fields,
    variants: [{ ...variant, caption: "Updated" }],
  });
  const edited = await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } });
  expect(edited.variants).toMatchObject([{ accountId: account.id, caption: "Updated", destination }]);
  await expect(send(editor, { action: "submit", postId, revision: edited.revision })).rejects.toThrow(
    "A selected account is unavailable",
  );
});

it("retains analytics for old team deliveries under the publishing connection", async () => {
  const { id: postId } = await setup(true);
  await send(editor, { action: "submit", postId, revision: 1 });
  const reviewId = (await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } })).currentReviewId!;
  const account = await prisma.connectedAccount.create({
    data: { userId: admin.id, platform: "instagram", platformAccountId: "legacy-profile", accessToken: "fixture" },
  });
  const delivery = await prisma.post.create({
    data: {
      workspaceReviewId: reviewId,
      userId: admin.id,
      message: "Legacy team delivery",
      status: "published",
      publishedAt: new Date(Date.now() - 60_000),
      accounts: { connect: { id: account.id } },
      accountResults: {
        [account.id]: { accountId: account.id, platform: "instagram", postId: "legacy-native-post", success: true },
      },
    },
  });
  await ensureAnalyticsRowsForUser(admin.id, { postIds: [delivery.id] });
  const personal = await listPostAnalytics(admin.id, { period: "last_7d" });
  expect(personal.posts).toMatchObject([{ postId: delivery.id, teamPostId: postId, teamWorkspaceId: wid }]);
  const team = await listPostAnalytics(admin.id, { period: "last_7d", workspaceId: wid });
  expect(team.posts).toEqual([]);
});

it("keeps destinationless legacy drafts and reviews, with no way to publish them", async () => {
  const { id: postId, revision } = await setup();
  await expect(send(editor, { action: "submit", postId, revision })).rejects.toThrow(
    "Choose a connected workspace account",
  );
  const workspace = await readWorkspace(admin, wid);
  const review = await prisma.teamReview.create({ data: { postId, requestedBy: editor.id, snapshot: fields } });
  await prisma.teamPost.update({
    where: { id: postId },
    data: { stateId: workspace.states.find((state) => state.kind === "review")!.id, currentReviewId: review.id },
  });
  await expect(
    send(viewer, { action: "decide", postId, reviewId: review.id, outcome: "approved", body: "" }),
  ).rejects.toThrow("Choose a connected workspace account");
  await prisma.teamReview.update({ where: { id: review.id }, data: { outcome: "approved" } });
  await prisma.teamPost.update({
    where: { id: postId },
    data: { stateId: workspace.states.find((state) => state.kind === "approved")!.id },
  });
  await expect(release(admin, wid, postId, review.id)).rejects.toThrow("Choose a connected workspace account");
  expect(await prisma.teamPost.findUnique({ where: { id: postId } })).toMatchObject({ deliveredAt: null });
  expect(await prisma.post.count({ where: { workspaceReviewId: review.id } })).toBe(0);
  expect(await prisma.teamEvent.count({ where: { postId, kind: "published natively" } })).toBe(0);
});

it("checks the approved account identity again before approval and scheduling", async () => {
  const { id: postId, revision } = await setup(true);
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { workspaceId: wid } });
  await send(editor, { action: "submit", postId, revision });
  const { currentReviewId: reviewId } = await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } });
  const approve = { action: "decide", postId, reviewId, outcome: "approved", body: "" };
  expect(() => send(viewer, { ...approve, outcome: "changes", body: "  " })).toThrow("Describe the changes");
  await prisma.connectedAccount.update({ where: { id: account.id }, data: { platformAccountId: "different" } });
  await expect(send(viewer, approve)).rejects.toThrow("A selected account is unavailable");
  await prisma.connectedAccount.update({
    where: { id: account.id },
    data: { platformAccountId: account.platformAccountId },
  });
  await send(viewer, approve);
  await prisma.connectedAccount.delete({ where: { id: account.id } });
  await expect(release(admin, wid, postId, reviewId!)).rejects.toThrow("A selected account is unavailable");
  expect(await prisma.teamPost.findUnique({ where: { id: postId } })).toMatchObject({ deliveredAt: null });
});

it("does not switch the account identity while saving an unrelated edit", async () => {
  const { id: postId, revision } = await setup(true);
  const account = await prisma.connectedAccount.findFirstOrThrow({ where: { workspaceId: wid } });
  const platform = fields.variants[0];
  await prisma.connectedAccount.update({ where: { id: account.id }, data: { platformAccountId: "replacement" } });
  await send(editor, {
    ...fields,
    action: "edit",
    postId,
    revision,
    variants: [{ ...platform, accountId: account.id, caption: "Updated" }],
  });
  const saved = await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } });
  expect(saved.variants).toMatchObject([{ destination: { platformAccountId: account.platformAccountId } }]);
  await expect(send(editor, { action: "submit", postId, revision: saved.revision })).rejects.toThrow(
    "account is unavailable",
  );
  await send(editor, {
    ...fields,
    action: "edit",
    postId,
    revision: saved.revision,
    variants: [
      { ...platform, accountId: account.id, destination: { label: "Replacement", platformAccountId: "replacement" } },
    ],
  });
  await expect(send(editor, { action: "submit", postId, revision: saved.revision + 1 })).resolves.toBeDefined();
});

it("rejects other workspace, personal, and wrong-platform destinations from editors", async () => {
  await setup();
  const otherWorkspace = await createWorkspace(admin, { ...newTeam, name: "Other workspace" });
  for (const destination of [
    { workspaceId: null, platform: "linkedin" },
    { workspaceId: otherWorkspace.id, platform: "linkedin" },
    { workspaceId: wid, platform: "instagram" },
  ]) {
    const account = await prisma.connectedAccount.create({
      data: { ...destination, userId: admin.id, platformAccountId: "separate-account", accessToken: "fixture" },
    });
    await expect(
      send(editor, {
        ...fields,
        action: "createPost",
        variants: [{ ...fields.variants[0], accountId: account.id }],
      }),
    ).rejects.toThrow("Connected destination unavailable");
  }
});

it("stops an old review from scheduling after its planned time has passed", async () => {
  const { id: postId, revision } = await setup(true);
  await send(editor, { action: "submit", postId, revision });
  const { currentReviewId: reviewId } = await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } });
  const review = await prisma.teamReview.findUniqueOrThrow({ where: { id: reviewId! } });
  await prisma.teamReview.update({
    where: { id: review.id },
    data: { snapshot: { ...snapshotSchema.parse(review.snapshot), plannedAt: "2020-01-01T00:00:00.000Z" } },
  });
  await expect(send(viewer, { action: "decide", postId, reviewId, outcome: "approved", body: "" })).rejects.toThrow(
    "Choose a future publication time",
  );
  const approved = await prisma.teamState.findFirstOrThrow({ where: { workspaceId: wid, kind: "approved" } });
  await prisma.teamReview.update({ where: { id: review.id }, data: { outcome: "approved" } });
  await prisma.teamPost.update({ where: { id: postId }, data: { stateId: approved.id } });
  await expect(release(admin, wid, postId, review.id)).rejects.toThrow("Choose a future publication time");
});

it("saves a reordered workflow atomically and refuses stale or protected deletions", async () => {
  wid = (await createWorkspace(admin, newTeam)).id;
  const snapshot = async () =>
    (await readWorkspace(admin, wid)).states.map(({ id, name, position }) => ({ id, name, position }));
  const expected = await snapshot();
  const [draft, progress, review, approved] = expected;
  await send(admin, {
    action: "workflow",
    expected,
    states: [
      { id: progress.id, name: draft.name },
      { id: draft.id, name: progress.name },
      { name: "Design ready" },
      { id: review.id, name: review.name },
    ],
  });
  const reordered = await snapshot();
  expect(reordered.map(({ name }) => name)).toEqual(["Draft", "In progress", "Design ready", "In review", "Approved"]);
  expect(reordered[0].id).toBe(progress.id);
  expect(reordered.at(-1)?.id).toBe(approved.id);
  await expect(send(admin, { action: "workflow", expected, states: [draft, progress, review] })).rejects.toThrow(
    "workflow changed",
  );
  await expect(
    send(admin, { action: "workflow", expected: reordered, states: reordered.slice(1, -1) }),
  ).rejects.toThrow("Only unused custom states");
  expect(await snapshot()).toEqual(reordered);
  await send(admin, { action: "workflow", expected: reordered, states: [reordered[0], reordered[1], reordered[3]] });
  expect((await snapshot()).map(({ name }) => name)).toEqual(["Draft", "In progress", "In review", "Approved"]);
});

it("retains the same invite for delivery retry and records successful email delivery", async () => {
  wid = (await createWorkspace(admin, { ...newTeam, name: "Studio & Design" })).id;
  const cmd = { action: "invite", email: editor.email, role: "Editor", approver: true };
  await send(admin, cmd);
  const invite = await prisma.teamInvite.findFirstOrThrow({ where: { workspaceId: wid } });
  jest
    .mocked(sendNotificationEmail)
    .mockRejectedValueOnce(new Error("provider unreachable"))
    .mockResolvedValueOnce("confirmed");
  await expect(deliverWorkspaceInvitation(invite.id)).resolves.toBe(false);
  await send(admin, cmd);
  expect(await prisma.teamInvite.count({ where: { workspaceId: wid } })).toBe(1);
  expect(await prisma.teamInvite.findUniqueOrThrow({ where: { id: invite.id } })).toMatchObject({ emailSentAt: null });
  const retry = await send(admin, { action: "resendInvite", inviteId: invite.id });
  expect(retry).toMatchObject({ id: invite.id });
  await expect(deliverWorkspaceInvitation(invite.id)).resolves.toBe(true);
  const delivered = await prisma.teamInvite.findUniqueOrThrow({ where: { id: invite.id } });
  expect(delivered.emailSentAt).toBeInstanceOf(Date);
  expect(jest.mocked(sendNotificationEmail)).toHaveBeenLastCalledWith(
    expect.objectContaining({
      to: editor.email,
      html: expect.stringContaining("Studio &amp; Design"),
      text: expect.stringContaining(`/workspace-invitation?team=${wid}&invite=${invite.id}`),
    }),
    `workspace-invite/${invite.id}`,
  );
  await expect(deliverWorkspaceInvitation(delivered.id)).resolves.toBe(true);
  expect(sendNotificationEmail).toHaveBeenCalledTimes(2);
});

it("converts workspace logos to bounded WebP and persists custom colors", async () => {
  const png = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#CB5AD3" } })
    .png()
    .toBuffer();
  await expect(normalizeWorkspaceLogo("data:image/png;base64,YmFk")).rejects.toThrow("valid PNG");
  wid = (await createWorkspace(admin, newTeam)).id;
  await send(admin, {
    action: "settings",
    ...newTeam,
    color: "#CB5AD3",
    logo: `data:image/png;base64,${png.toString("base64")}`,
  });
  const saved = await readWorkspace(admin, wid);
  expect(saved.color).toBe("#cb5ad3");
  expect(saved.logo).toMatch(/^data:image\/webp;base64,/);
  await send(admin, { action: "settings", ...newTeam, color: "indigo", logo: null });
  expect((await readWorkspace(admin, wid)).logo).toBeNull();
});

it("hands shared accounts, deliveries, and history to the remaining admin when the owner is removed", async () => {
  const post = await setup();
  await expect(send(admin, { action: "remove", userId: admin.id })).rejects.toThrow("last admin");
  await send(admin, { action: "member", userId: editor.id, role: "Admin", approver: true });
  await prisma.userFeature.create({ data: { userId: editor.id, feature: "TEAM_WORKSPACES" } });

  const teamAccount = await prisma.connectedAccount.create({
    data: {
      userId: admin.id,
      workspaceId: wid,
      platform: "linkedin",
      platformAccountId: "team",
      accessToken: "fixture",
    },
  });
  const personalAccount = await prisma.connectedAccount.create({
    data: { userId: admin.id, platform: "linkedin", platformAccountId: "personal", accessToken: "fixture" },
  });
  const review = await prisma.teamReview.create({
    data: { postId: post.id, snapshot: {}, requestedBy: admin.id, outcome: "approved" },
  });
  const previousBase = process.env.S3_STORAGE_BASE_URL;
  process.env.S3_STORAGE_BASE_URL = "https://media.example.invalid";
  const key = generateFileKey(admin.id, "workspace.png");
  const url = `https://media.example.invalid/${key}`;
  try {
    const delivery = await prisma.post.create({
      data: {
        userId: admin.id,
        workspaceReviewId: review.id,
        message: "From the workspace",
        status: "pending",
        accounts: { connect: { id: teamAccount.id } },
        media: { create: { url, type: "image", filename: "workspace.png", size: 100 } },
      },
    });
    await prisma.storageDeletion.create({ data: { key, userId: admin.id, dueAt: new Date(0) } });
    const item = await prisma.socialActivityItem.create({
      data: {
        userId: admin.id,
        accountId: teamAccount.id,
        postId: delivery.id,
        platform: "linkedin",
        kind: "comment",
        body: "A comment",
        nativeId: "a-comment",
        nativePostId: "a-post",
        eventAt: new Date(),
      },
    });
    await prisma.socialActivityReply.create({
      data: {
        userId: admin.id,
        accountId: teamAccount.id,
        activityItemId: item.id,
        idempotencyKey: "previous-reply",
        body: "Reply",
        status: "sent",
      },
    });
    await expect(send(editor, { action: "remove", userId: admin.id })).rejects.toThrow("current publishing run");
    expect((await prisma.teamWorkspace.findUniqueOrThrow({ where: { id: wid } })).creatorId).toBe(admin.id);
    await prisma.post.update({ where: { id: delivery.id }, data: { status: "scheduled" } });
    await send(editor, { action: "remove", userId: admin.id });
    await expect(readWorkspace(admin, wid)).rejects.toThrow("Workspace not found");
    await expect(workspaceConnections(editor.id, wid, true)).resolves.toMatchObject({ userId: editor.id });
    expect(await prisma.connectedAccount.findUnique({ where: { id: teamAccount.id } })).toMatchObject({
      userId: editor.id,
    });
    expect(await prisma.connectedAccount.findUnique({ where: { id: personalAccount.id } })).toMatchObject({
      userId: admin.id,
    });
    expect(await prisma.post.findUnique({ where: { id: delivery.id } })).toMatchObject({
      userId: editor.id,
      storageOwnerId: admin.id,
    });
    expect(
      await prisma.socialActivityItem.findUnique({ where: { id: item.id }, include: { replies: true } }),
    ).toMatchObject({ userId: editor.id, replies: [{ userId: editor.id, status: "sent" }] });

    jest.mocked(deleteFromStorage).mockClear();
    await collectUnusedStorage();
    expect(jest.mocked(deleteFromStorage).mock.calls.map(([key]) => key)).not.toContain(key);
    await cancelDelivery(editor, wid, post.id, delivery.id);
    await prisma.storageDeletion.update({ where: { key }, data: { dueAt: new Date(0) } });
    await collectUnusedStorage();
    expect(jest.mocked(deleteFromStorage).mock.calls.map(([key]) => key)).toContain(key);
  } finally {
    if (previousBase === undefined) delete process.env.S3_STORAGE_BASE_URL;
    else process.env.S3_STORAGE_BASE_URL = previousBase;
  }
});

it("keeps an admin when two admins try to remove each other concurrently", async () => {
  await setup();
  await send(admin, { action: "member", userId: editor.id, role: "Admin", approver: true });
  const results = await Promise.allSettled([
    send(admin, { action: "remove", userId: editor.id }),
    send(editor, { action: "remove", userId: admin.id }),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const admins = await prisma.teamMember.findMany({ where: { workspaceId: wid, role: "Admin" } });
  expect(admins).toHaveLength(1);
  expect((await prisma.teamWorkspace.findUniqueOrThrow({ where: { id: wid } })).creatorId).toBe(admins[0].userId);
});

it("lets the owner remove themself once another member is an admin", async () => {
  await setup();
  await prisma.teamInvite.create({
    data: {
      workspaceId: wid,
      email: "pending@example.test",
      role: "Admin",
      approver: true,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await expect(send(admin, { action: "remove", userId: admin.id })).rejects.toThrow("last admin");
  await send(admin, { action: "member", userId: editor.id, role: "Admin", approver: true });

  await send(admin, { action: "remove", userId: admin.id });

  expect(await readWorkspace(editor, wid)).toMatchObject({ creatorId: editor.id, member: { role: "Admin" } });
  await expect(readWorkspace(admin, wid)).rejects.toThrow("Workspace not found");
});
