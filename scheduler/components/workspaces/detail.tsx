import { useState } from "react";

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
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { Snapshot } from "@/lib/workspaces/contracts";

import { WorkspacePreview } from "./preview";
import { displayDate, platformName, type Item, type Workspace, type Run } from "./types";

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
  "published natively": "marked the post as published natively",
};
export function Content({ workspace: w, snapshot }: { workspace: Workspace; snapshot: Snapshot }) {
  return (
    <div className="grid gap-3">
      <WorkspacePreview workspace={w} variants={snapshot.variants} date={new Date(snapshot.plannedAt)} />
      {snapshot.variants.map((v) => (
        <div key={v.platform} className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>
            {platformName[v.platform]} · {v.destination?.label ?? "Native publishing"}{" "}
            {Object.values(v.options).join(" · ")}
          </span>
          {v.fileIds.map((id) => {
            const file = w.files.find((f) => f.id === id);
            return (
              file && (
                <a
                  className="underline"
                  key={id}
                  href={`/api/v1/workspaces/${w.id}/files/${id}`}
                  download={file.filename}>
                  {file.filename}
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
  const [comment, setComment] = useState("");
  const review = p.reviews.find((r) => r.id === p.currentReviewId);
  const state = w.states.find((s) => s.id === p.stateId)!;
  const editor = w.member.role !== "Viewer";
  const pending = state.kind === "review" && review && !review.outcome;
  const snapshot = queue && review ? review.snapshot : p;
  const connected = snapshot.variants.some((v) => v.accountId);
  return (
    <article className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-4 sm:p-6">
      <header className="space-y-2">
        <Badge variant={state.kind === "approved" ? "default" : "secondary"}>{state.name}</Badge>
        <h2 className="text-lg font-semibold tracking-tight">{snapshot.title}</h2>
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
      <Content workspace={w} snapshot={snapshot} />
      <div className="flex flex-wrap items-end gap-2">
        {editor && !queue && (
          <Button variant="outline" size="sm" onClick={edit}>
            Edit post
          </Button>
        )}
        {editor && !p.deliveredAt && !pending && state.kind !== "approved" && (
          <Button size="sm" onClick={() => void run({ action: "submit", postId: p.id, revision: p.revision })}>
            Submit for review
          </Button>
        )}
        {editor && !queue && !p.deliveredAt && (
          <Label className="min-w-0 flex-col items-stretch">
            Move to{" "}
            <NativeSelect
              value=""
              onChange={(e) =>
                void run({ action: "move", postId: p.id, revision: p.revision, stateId: e.target.value })
              }>
              <option value="">Select state</option>
              {w.states
                .filter((s) => !["review", "approved"].includes(s.kind) && s.id !== p.stateId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </NativeSelect>
          </Label>
        )}
        {w.member.approver && pending && (
          <>
            <Button
              size="sm"
              onClick={() =>
                void run({ action: "decide", postId: p.id, reviewId: review.id, outcome: "approved", body: "" })
              }>
              Approve
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRequesting(!requesting)}>
              Request changes
            </Button>
          </>
        )}
        {editor &&
          !p.deliveredAt &&
          state.kind === "approved" &&
          review &&
          (!connected || w.creatorId === w.member.userId) && (
            <Button size="sm" onClick={() => void run({ action: "release", postId: p.id, reviewId: review.id })}>
              {connected ? "Schedule with SimplePost" : "Mark as published natively"}
            </Button>
          )}
        {p.deliveredAt &&
          w.member.userId === w.creatorId &&
          review?.deliveries
            .filter((delivery) => delivery.status === "scheduled")
            .map((delivery) => (
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
        {p.deliveredAt && (
          <strong>
            {connected
              ? `SimplePost · ${review?.deliveries.map((d) => d.status).join(", ") || "Canceled"}`
              : "Published natively"}
          </strong>
        )}
      </div>
      {requesting && pending && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run({ action: "decide", postId: p.id, reviewId: review.id, outcome: "changes", body: feedback })
            ) {
              setFeedback("");
              setRequesting(false);
            }
          }}>
          <Label className="min-w-0 flex-col items-stretch">
            Requested changes
            <Textarea autoFocus value={feedback} maxLength={4000} onChange={(e) => setFeedback(e.target.value)} />
          </Label>
          <Button variant="outline" size="sm" type="submit">
            Send change request
          </Button>
        </form>
      )}
      <section className="space-y-3 border-t border-border pt-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">Discussion and activity</h3>
        {p.events.map((event) => (
          <div key={event.id} className="break-words border-s-2 border-border ps-3 text-sm">
            <strong>{event.actorName}</strong> {activity[event.kind] ?? event.kind}
            <small className="block text-xs text-muted-foreground">{displayDate(event.createdAt)}</small>
            {event.body && <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{event.body}</p>}
          </div>
        ))}
        {(editor || w.member.approver) && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run({ action: "comment", postId: p.id, body: comment })) setComment("");
            }}>
            <Label className="min-w-0 flex-col items-stretch">
              Add a comment
              <Textarea required maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} />
            </Label>
            <Button variant="outline" size="sm" disabled={!comment.trim()}>
              Post comment
            </Button>
          </form>
        )}
      </section>
      {p.reviews.length > 0 && (
        <section>
          <h3 className="flex items-center gap-2 text-sm font-semibold">Review history</h3>
          {p.reviews.map((r, i) => (
            <details key={r.id} className="mt-2 space-y-2 border-t border-border pt-3 text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                Version {p.reviews.length - i} · {r.outcome ?? "Awaiting decision"} · {displayDate(r.requestedAt)}
              </summary>
              <strong>{r.snapshot.title}</strong>
              <p>{displayDate(r.snapshot.plannedAt)}</p>
              <Content workspace={w} snapshot={r.snapshot} />
            </details>
          ))}
        </section>
      )}
    </article>
  );
}
