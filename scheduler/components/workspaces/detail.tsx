import { useState } from "react";

import Link from "next/link";

import { ArrowRightLeft, ChevronDown, Circle, Link2, MessageSquare, Paperclip, Pencil } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Snapshot } from "@/lib/workspaces/contracts";

import { WorkspacePreview } from "./preview";
import { workspaceHref } from "./switcher";
import { displayDate, platformName, workspacePostStatus, type Item, type Workspace, type Run } from "./types";

const activity: Record<string, string> = {
  changes: "requested changes",
  approved: "approved this version",
  created: "created the post",
  edited: "edited the post",
  moved: "moved the post to",
  submitted: "submitted a version for review",
  superseded: "withdrew the review request",
  "approval invalidated": "reopened the approved post",
  "delivery removed": "removed a SimplePost delivery",
  comment: "commented",
  scheduled: "scheduled the approved version",
  "published natively": "recorded a previously published post",
};

const reviewOutcomes: Record<string, string> = {
  approved: "Approved",
  changes: "Changes requested",
  superseded: "Withdrawn",
};

export function Content({ workspace: w, snapshot }: { workspace: Workspace; snapshot: Snapshot }) {
  return (
    <div className="grid gap-3">
      <WorkspacePreview workspace={w} variants={snapshot.variants} date={new Date(snapshot.plannedAt)} />
      {snapshot.variants.map((v) => (
        <div key={v.platform} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{platformName[v.platform]}</span>
          <span className="min-w-0 wrap-anywhere">
            {[v.destination?.label ?? "No account selected", ...Object.values(v.options)].join(" · ")}
          </span>
          {v.fileIds.map((id) => {
            const file = w.files.find((f) => f.id === id);
            return (
              file && (
                <a
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-md border border-border px-2 py-1 hover:bg-secondary hover:text-foreground"
                  key={id}
                  href={`/api/v1/workspaces/${w.id}/files/${id}`}
                  download={file.filename}>
                  <Paperclip className="size-3 shrink-0" aria-hidden />
                  <span className="truncate">{file.filename}</span>
                </a>
              )
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function PostDetail({
  workspace: w,
  post: p,
  run,
  edit,
  queue = false,
}: {
  workspace: Workspace;
  post: Item;
  run: Run;
  edit: () => void;
  queue?: boolean;
}) {
  const [feedback, setFeedback] = useState("");
  const [requesting, setRequesting] = useState(false);
  const [moveTarget, setMoveTarget] = useState<Workspace["states"][number]>();
  const review = p.reviews.find((r) => r.id === p.currentReviewId);
  const state = w.states.find((s) => s.id === p.stateId)!;
  const editor = w.member.role !== "Viewer";
  const pending = state.kind === "review" && review && !review.outcome;
  const reviewToDecide = w.member.approver && pending ? review : undefined;
  const canEdit = editor && !queue;
  const moveTargets = w.states.filter((s) => !["review", "approved"].includes(s.kind) && s.id !== p.stateId);
  const snapshot = queue && review ? review.snapshot : p;
  const ownsConnections = w.creatorId === w.member.userId;
  const { label, missingPlatforms, timePassed } = workspacePostStatus(w, p, snapshot);
  const hasDestinations = missingPlatforms.length === 0;
  const publishable = hasDestinations && !timePassed;
  const canSubmit = editor && !p.deliveredAt && !pending && state.kind !== "approved" && publishable;
  const canSchedule = editor && ownsConnections;
  const scheduledDeliveries = review?.deliveries.filter((delivery) => delivery.status === "scheduled") ?? [];
  const move = (stateId: string) => run({ action: "move", postId: p.id, revision: p.revision, stateId });
  return (
    <article className="@container min-w-0 space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 space-y-2">
            <Badge variant="secondary">{label}</Badge>
            <h2 className="text-lg font-semibold tracking-tight wrap-anywhere">{snapshot.title}</h2>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" onClick={edit}>
                <Pencil aria-hidden /> Edit post
              </Button>
              {!p.deliveredAt && moveTargets.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <ArrowRightLeft aria-hidden /> Move to <ChevronDown aria-hidden />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {moveTargets.map((target) => (
                      <DropdownMenuItem
                        key={target.id}
                        onSelect={() => {
                          if (pending || state.kind === "approved") setMoveTarget(target);
                          else void move(target.id);
                        }}>
                        {target.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground [&_b]:font-medium [&_b]:text-foreground">
          <span>
            Planned <b>{displayDate(snapshot.plannedAt)}</b>
          </span>
          <span>
            Owner <b>{w.members.find((m) => m.userId === p.ownerId)?.user.name ?? "Unassigned"}</b>
          </span>
          <span>
            Due <b>{p.dueAt ? displayDate(p.dueAt) : "No deadline"}</b>
          </span>
          {p.dueAt && new Date(p.dueAt) < new Date() && state.kind !== "approved" && !p.deliveredAt && (
            <Badge variant="destructive">Overdue</Badge>
          )}
          {review && (
            <span>
              Review version <b>{p.reviews.length - p.reviews.indexOf(review)}</b>
            </span>
          )}
        </div>
      </header>
      <AlertDialog open={Boolean(moveTarget)} onOpenChange={(open) => !open && setMoveTarget(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to {moveTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? "This will withdraw the current review request." : "This version will need approval again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => moveTarget && void move(moveTarget.id)}>Move post</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!p.deliveredAt && !publishable && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3.5 sm:p-4">
          <div className="flex min-w-0 items-start gap-2.5">
            <Link2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">
                {hasDestinations ? "Planned time has passed" : "Workspace account needed"}
              </h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {hasDestinations
                  ? "Choose a future publication time to continue."
                  : w.accounts.length === 0 && !ownsConnections
                    ? `Ask the workspace owner to connect an account for ${missingPlatforms.join(", ")}.`
                    : `Choose a connected workspace account for ${missingPlatforms.join(", ")} to continue.`}
              </p>
            </div>
          </div>
          {!hasDestinations && w.accounts.length === 0 && ownsConnections ? (
            <Button size="sm" variant="outline" asChild>
              <Link href={workspaceHref("/accounts", w.id)}>Open Accounts</Link>
            </Button>
          ) : (
            editor && (
              <Button size="sm" variant="outline" onClick={edit}>
                {hasDestinations ? "Edit planned time" : "Edit destinations"}
              </Button>
            )
          )}
        </section>
      )}
      {reviewToDecide && (
        <section className="rounded-xl border border-border bg-secondary/40 p-3.5 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Review decision</h3>
            {!requesting && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setRequesting(true)}>
                  Request changes
                </Button>
                <Button
                  size="sm"
                  disabled={!publishable}
                  onClick={() =>
                    void run({
                      action: "decide",
                      postId: p.id,
                      reviewId: reviewToDecide.id,
                      outcome: "approved",
                      body: "",
                    })
                  }>
                  Approve
                </Button>
              </div>
            )}
          </div>
          {requesting && (
            <form
              className="mt-3 space-y-3"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await run({
                    action: "decide",
                    postId: p.id,
                    reviewId: reviewToDecide.id,
                    outcome: "changes",
                    body: feedback,
                  })
                ) {
                  setFeedback("");
                  setRequesting(false);
                }
              }}>
              <Label className="min-w-0 flex-col items-stretch">
                Requested changes
                <Textarea autoFocus value={feedback} maxLength={4000} onChange={(e) => setFeedback(e.target.value)} />
              </Label>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setRequesting(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit">
                  Send change request
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
      {canSubmit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => void run({ action: "submit", postId: p.id, revision: p.revision })}>
            Submit for review
          </Button>
        </div>
      )}
      {!p.deliveredAt && state.kind === "approved" && review && publishable && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-secondary/40 p-3.5 sm:p-4">
          <div>
            <h3 className="text-sm font-semibold">Ready to schedule</h3>
            {!canSchedule && (
              <p className="mt-0.5 text-xs text-muted-foreground">The workspace owner can schedule this post.</p>
            )}
          </div>
          {canSchedule && (
            <Button size="sm" onClick={() => void run({ action: "release", postId: p.id, reviewId: review.id })}>
              Schedule post
            </Button>
          )}
        </section>
      )}
      {p.deliveredAt && ownsConnections && scheduledDeliveries.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {scheduledDeliveries.map((delivery) => (
            <AlertDialog key={delivery.id}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline">
                  Cancel delivery
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel scheduled delivery?</AlertDialogTitle>
                  <AlertDialogDescription>The approved post stays in your workspace.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Keep scheduled</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void run({ action: "cancelDelivery", postId: p.id, deliveryId: delivery.id })}>
                    Cancel delivery
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ))}
        </div>
      )}
      <div className="grid items-start gap-5 @min-[52rem]:grid-cols-[minmax(0,1fr)_20rem]">
        <Content workspace={w} snapshot={snapshot} />
        <PostDiscussion post={p} run={run} canComment={editor || w.member.approver} />
      </div>
      {p.reviews.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Review history</h3>
          <div className="space-y-2">
            {p.reviews.map((r, i) => (
              <details key={r.id} className="group min-w-0 rounded-xl border border-border text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-3.5 py-2.5 hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                    <span className="font-medium">Version {p.reviews.length - i}</span>
                    <Badge variant="secondary">{(r.outcome && reviewOutcomes[r.outcome]) || "Awaiting decision"}</Badge>
                    <time dateTime={r.requestedAt} className="text-xs text-muted-foreground @min-[36rem]:ms-auto">
                      {displayDate(r.requestedAt)}
                    </time>
                  </div>
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden
                  />
                </summary>
                <div className="space-y-2 border-t border-border px-3.5 py-3">
                  <p className="font-medium wrap-anywhere">{r.snapshot.title}</p>
                  <p className="text-xs text-muted-foreground">Planned {displayDate(r.snapshot.plannedAt)}</p>
                  <Content workspace={w} snapshot={r.snapshot} />
                </div>
              </details>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

function PostDiscussion({ post, run, canComment }: { post: Item; run: Run; canComment: boolean }) {
  const [comment, setComment] = useState("");
  const discussion = post.events.filter(
    (event) => event.kind === "comment" || (event.kind === "changes" && event.body),
  );
  const log = post.events.filter((event) => !discussion.includes(event));
  return (
    <aside className="min-w-0 space-y-4 border-t border-border pt-4 @min-[52rem]:border-s @min-[52rem]:border-t-0 @min-[52rem]:ps-4 @min-[52rem]:pt-0">
      {(discussion.length > 0 || canComment) && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Discussion</h3>
          {discussion.length > 0 && <PostEvents events={discussion} />}
          {canComment && (
            <form
              className="min-w-0 rounded-xl border border-border bg-input/35 p-1 focus-within:border-ring/60"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run({ action: "comment", postId: post.id, body: comment })) setComment("");
              }}>
              <Textarea
                required
                aria-label="Add a comment"
                placeholder="Add a comment…"
                maxLength={4000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="min-h-12 resize-none border-0 bg-transparent focus-visible:ring-1"
              />
              <div className="flex justify-end px-1 pt-1 pb-1">
                <Button type="submit" variant="secondary" size="sm" disabled={!comment.trim()} className="h-8 text-xs">
                  Post comment
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
      {log.length > 0 && (
        <details className="group rounded-xl border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm font-medium hover:bg-secondary/60 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            Activity
            <ChevronDown className="size-4 text-muted-foreground group-open:rotate-180" aria-hidden />
          </summary>
          <div className="border-t border-border px-3.5 py-3">
            <PostEvents events={log} />
          </div>
        </details>
      )}
    </aside>
  );
}

function PostEvents({ events }: { events: Item["events"] }) {
  return (
    <ol className="relative space-y-3 before:absolute before:start-3 before:top-3 before:bottom-3 before:w-px before:bg-border">
      {events.map((event) => (
        <li key={event.id} className="relative flex items-start gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border bg-card text-muted-foreground">
            {event.kind === "comment" ? (
              <MessageSquare className="size-3" aria-hidden />
            ) : (
              <Circle className="size-1.5 fill-current" aria-hidden />
            )}
          </span>
          <div className="min-w-0 pt-0.5 text-sm wrap-anywhere">
            <p>
              <strong className="font-medium">{event.actorName}</strong>{" "}
              <span className="text-muted-foreground">{activity[event.kind] ?? event.kind}</span>
            </p>
            <time dateTime={event.createdAt} className="block text-xs text-muted-foreground">
              {displayDate(event.createdAt)}
            </time>
            {event.body && <p className="mt-1 whitespace-pre-wrap">{event.body}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
