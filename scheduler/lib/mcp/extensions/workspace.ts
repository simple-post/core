import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";
import { z } from "zod";

import { lockUserForQuota } from "@/lib/billing/subscriptions";
import { PostsModel } from "@/lib/db";
import { listAccounts } from "@/lib/mcp/tools/accounts";
import { createPost, inspectPosts } from "@/lib/mcp/tools/posts";
import { getSchedule } from "@/lib/mcp/tools/schedule";
import { executePostUpdate } from "@/lib/posting/update-post";
import { readPublishingPreferences, timeZoneSchema } from "@/lib/preferences/publishing";
import { prisma } from "@/lib/prisma";
import { ApiError, ConflictError, NotFoundError } from "@/lib/utils/errors";
import { assertStorageAvailable, queueStorageDeletion } from "@/lib/utils/storage-lifecycle";
import { validatePostForAccounts } from "@/lib/validation/sdk-validation";
import { scheduledInstant } from "@/mcp-ui/extensions/timezone";

import {
  editorContentSchema,
  type proposalSchema,
  type sessionCommitSchema,
  type sessionUpdateSchema,
} from "./contracts";

export const workspaceInputSchema = z.object({
  view: z.enum(["day", "week", "month"]).optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timeZone: timeZoneSchema.optional(),
  status: z.enum(["drafts", "scheduled", "posted", "failed"]).default("drafts"),
  page: z.number().int().min(1).default(1),
});

export async function loadWorkspace(userId: string, input: z.infer<typeof workspaceInputSchema>) {
  const preferences = await readPublishingPreferences(userId);
  const [schedule, accounts, posts, sessions] = await Promise.all([
    getSchedule(userId, {
      view: input.view ?? preferences.calendarView,
      date: input.date,
      timeZone: input.timeZone ?? preferences.timeZone,
    }),
    listAccounts(userId),
    inspectPosts(userId, { status: input.status, page: input.page, limit: 20 }),
    prisma.postEditorSession.findMany({
      where: { userId, expiresAt: { gt: new Date() } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, postId: true, payload: true, updatedAt: true, revision: true, committing: true },
    }),
  ]);
  return {
    kind: "workspace" as const,
    preferences,
    schedule,
    accounts: accounts.accounts,
    posts,
    recovery: sessions.map((session) => ({
      id: session.id,
      postId: session.postId,
      message: editorContentSchema.parse(session.payload).message.slice(0, 100),
      updatedAt: session.updatedAt.toISOString(),
      revision: session.revision,
      committing: session.committing,
    })),
  };
}

export async function startEditor(userId: string, postId?: string) {
  const preferences = await readPublishingPreferences(userId);
  const post = postId ? await new PostsModel(userId).getPostById(postId) : null;
  if (postId && !post) throw new NotFoundError("That post is no longer available.");
  const editable =
    !post ||
    post.status === "draft" ||
    (post.status === "scheduled" && !!post.scheduledFor && post.scheduledFor > new Date());
  if (!editable) throw new ConflictError("This post cannot be edited. Inspect its results in SimplePost.");
  const accounts = await listAccounts(userId);
  const content = editorContentSchema.parse(
    post
      ? {
          message: post.message,
          accountIds: post.accountIds,
          media: post.media,
          thread: post.thread ?? [],
          accountOverrides: post.accountOverrides ?? {},
          accountOptions: post.accountOptions ?? {},
          quotePostId: post.quotePostId ?? null,
        }
      : {
          message: "",
          accountIds: preferences.defaultAccountIds.filter((id) => accounts.accounts.some((a) => a.accountId === id)),
        },
  );
  const session = await prisma.$transaction(async (tx) => {
    await lockUserForQuota(tx, userId);
    if ((await tx.postEditorSession.count({ where: { userId, expiresAt: { gt: new Date() } } })) >= 500)
      throw new ConflictError("You have too many active working copies. Reuse one from the workspace.");
    await assertStorageAvailable(tx, userId, content);
    await queueStorageDeletion(tx, userId, content);
    return tx.postEditorSession.create({
      data: {
        id: randomUUID(),
        userId,
        postId: post?.id,
        baseUpdatedAt: post?.updatedAt,
        payload: json(content),
        expiresAt: expiry(),
      },
    });
  });
  return editorResult(session, post?.status ?? "new", post?.scheduledFor?.toISOString() ?? null);
}

function json(value: unknown): Prisma.InputJsonValue {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- Normalize Dates and undefined for Prisma JSON.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
function expiry() {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
}
function editorResult(
  session: {
    id: string;
    postId: string | null;
    baseUpdatedAt: Date | null;
    revision: number;
    payload: unknown;
    proposal: unknown;
    committing: boolean;
  },
  status?: string,
  scheduledFor?: string | null,
) {
  return {
    kind: "editor" as const,
    sessionId: session.id,
    postId: session.postId,
    baseUpdatedAt: session.baseUpdatedAt?.toISOString() ?? null,
    revision: session.revision,
    content: editorContentSchema.parse(session.payload),
    proposal: session.proposal,
    committing: session.committing,
    status,
    scheduledFor,
  };
}
export async function readEditor(userId: string, sessionId: string) {
  const session = await prisma.postEditorSession.findFirst({
    where: { id: sessionId, userId, expiresAt: { gt: new Date() } },
  });
  if (!session) throw new NotFoundError("This working copy expired or is unavailable. Open the saved draft again.");
  const post = session.postId ? await new PostsModel(userId).getPostById(session.postId) : null;
  return {
    ...editorResult(session, post?.status ?? "new", post?.scheduledFor?.toISOString() ?? null),
    remotelyChanged: !!post && post.updatedAt.toISOString() !== session.baseUpdatedAt?.toISOString(),
  };
}
export async function updateEditor(userId: string, input: z.infer<typeof sessionUpdateSchema>) {
  const updated = await prisma.$transaction(async (tx) => {
    await lockUserForQuota(tx, userId);
    await assertStorageAvailable(tx, userId, input.content);
    await queueStorageDeletion(tx, userId, input.content);
    return tx.postEditorSession.updateMany({
      where: {
        id: input.sessionId,
        userId,
        revision: input.expectedRevision,
        committing: false,
        expiresAt: { gt: new Date() },
      },
      data: {
        payload: json(input.content),
        revision: { increment: 1 },
        proposal: Prisma.DbNull,
        expiresAt: expiry(),
      },
    });
  });
  if (!updated.count)
    throw new ConflictError(
      "This working copy changed or a save is in progress. Reload it without discarding your changes.",
    );
  return readEditor(userId, input.sessionId);
}
export async function proposeEdit(userId: string, input: z.infer<typeof proposalSchema>) {
  // Proposals never update the saved post or scratch content.
  const updated = await prisma.$transaction(async (tx) => {
    await lockUserForQuota(tx, userId);
    await assertStorageAvailable(tx, userId, input.patch);
    await queueStorageDeletion(tx, userId, input.patch);
    return tx.postEditorSession.updateMany({
      where: {
        id: input.sessionId,
        userId,
        revision: input.expectedRevision,
        committing: false,
        expiresAt: { gt: new Date() },
      },
      data: {
        proposal: json({ patch: input.patch, explanation: input.explanation, revision: input.expectedRevision }),
      },
    });
  });
  if (!updated.count)
    throw new ConflictError("The editor changed. Read its current revision before proposing an edit.");
  return readEditor(userId, input.sessionId);
}
export async function validateEditor(
  userId: string,
  sessionId: string,
  expectedRevision: number,
  imageFit?: "crop" | "blur",
) {
  const editor = await readEditor(userId, sessionId);
  if (editor.revision !== expectedRevision)
    throw new ConflictError("The editor changed. Validate its current revision.");
  if (editor.content.accountIds.length === 0) throw new Error("Choose at least one connected destination.");
  return validatePostForAccounts({ userId, ...editor.content, imageFit, checkAccountReadiness: true });
}

export async function commitEditor(userId: string, input: z.infer<typeof sessionCommitSchema>) {
  const session = await prisma.postEditorSession.findFirst({
    where: { id: input.sessionId, userId, expiresAt: { gt: new Date() } },
  });
  if (!session) throw new NotFoundError("This working copy is unavailable.");
  const scheduledFor =
    input.mode === "schedule"
      ? (input.scheduledFor ??
        (input.scheduledLocal
          ? scheduledInstant(input.scheduledLocal, timeZoneSchema.parse(input.timeZone))
          : undefined))
      : undefined;
  if (input.mode === "schedule" && !scheduledFor) throw new Error("Choose a future scheduling time.");
  const action = JSON.stringify({ mode: input.mode, scheduledFor, imageFit: input.imageFit });
  if (session.commitRevision === input.expectedRevision && session.commitMode === action && session.commitResult)
    return session.commitResult;
  if (session.revision !== input.expectedRevision || session.committing)
    throw new ConflictError("The editor changed or a save is in progress. Refresh before taking another action.");
  const content = editorContentSchema.parse(session.payload);
  if (content.accountIds.length === 0) throw new Error("Connect and choose at least one destination before saving.");
  const claim = await prisma.postEditorSession.updateMany({
    where: { id: session.id, userId, revision: input.expectedRevision, committing: false },
    data: {
      committing: true,
      commitRevision: input.expectedRevision,
      commitMode: action,
      commitResult: Prisma.DbNull,
      expiresAt: expiry(),
    },
  });
  if (!claim.count) throw new ConflictError("A save is already in progress.");
  try {
    let postId = session.postId;
    // First save always creates a draft, including Publish now. A lost response reuses the same record.
    if (!postId) {
      const created = await createPost(userId, {
        ...content,
        quotePostId: content.quotePostId ?? undefined,
        postingMode: "draft",
        imageFit: input.imageFit,
        idempotencyKey: `editor:${session.id}:first-draft`,
      });
      postId = created.post.id;
      session.postId = postId;
      const post = await new PostsModel(userId).getPostById(postId);
      if (!post) throw new NotFoundError("The saved draft could not be loaded.");
      session.baseUpdatedAt = post.updatedAt;
      await prisma.postEditorSession.update({
        where: { id: session.id },
        data: { postId, baseUpdatedAt: post.updatedAt },
      });
    }
    const current = await new PostsModel(userId).getPostById(postId);
    if (!current || current.updatedAt.toISOString() !== session.baseUpdatedAt?.toISOString())
      throw new ConflictError("The saved post changed. Your working copy is safe; reload and compare before saving.");
    if (
      current.status !== "draft" &&
      !(current.status === "scheduled" && current.scheduledFor && current.scheduledFor > new Date())
    )
      throw new ConflictError("This post is publishing or no longer editable.");
    const result = await executePostUpdate(userId, postId, {
      ...content,
      expectedUpdatedAt: session.baseUpdatedAt?.toISOString(),
      postingMode: input.mode,
      scheduledFor,
      imageFit: input.imageFit,
    });
    const saved = await new PostsModel(userId).getPostById(postId);
    if (!saved) throw new NotFoundError("The saved post could not be loaded.");
    const next = {
      ...session,
      committing: false,
      revision: session.revision + 1,
      baseUpdatedAt: saved.updatedAt,
      payload: json({
        ...content,
        media: saved.media,
        thread: saved.thread ?? [],
        accountOptions: saved.accountOptions ?? {},
        accountOverrides: saved.accountOverrides ?? {},
      }),
      proposal: null,
    };
    const response = {
      editor: editorResult(next, saved.status, saved.scheduledFor?.toISOString() ?? null),
      outcome: result,
    };
    // Persist the receipt with the new revision: a replay sees either the claim or the complete receipt.
    await prisma.postEditorSession.update({
      where: { id: session.id },
      data: {
        committing: false,
        revision: next.revision,
        baseUpdatedAt: saved.updatedAt,
        payload: next.payload,
        proposal: Prisma.DbNull,
        expiresAt: expiry(),
        commitResult: json(response),
      },
    });
    return json(response);
  } catch (error) {
    // A publish attempt that may have reached a platform must never be automatically restarted.
    const post = session.postId ? await new PostsModel(userId).getPostById(session.postId) : null;
    const terminalPublish = input.mode === "now" && post && ["pending", "published", "failed"].includes(post.status);
    if (!terminalPublish)
      await prisma.postEditorSession.updateMany({ where: { id: session.id, userId }, data: { committing: false } });
    if (terminalPublish)
      throw new ApiError(
        "Publishing may have completed or partially failed. Refresh the post results in SimplePost; do not retry publishing this working copy.",
        409,
        "PUBLISH_OUTCOME_REQUIRES_REVIEW",
      );
    throw error;
  }
}
