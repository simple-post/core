/* eslint-disable unicorn/no-await-expression-member -- Integration assertions inspect committed database values. */
import { uploadFromBuffer, deleteFromStorage } from "@simple-post/sdk";
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
import { commandSchema, type Actor } from "@/lib/workspaces/contracts";
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
      workspaceId: wid,
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
  expect(await repo.getPostsBetween(new Date("2035-01-01"), new Date("2035-01-02"))).toHaveLength(1);
  await expect(repo.getPostById(deliveries[0].id)).resolves.toBeNull();
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
  await send(editor, { action: "submit", postId, revision: edited.revision });
  const reviewId = (await prisma.teamPost.findUniqueOrThrow({ where: { id: postId } })).currentReviewId!;
  await send(viewer, { action: "decide", postId, reviewId, outcome: "approved", body: "" });
  await expect(release(admin, wid, postId, reviewId)).rejects.toThrow("reviewed destination is unavailable");
});

it("retains analytics for old team deliveries under the publishing connection", async () => {
  const { id: postId } = await setup();
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
