import { useState } from "react";

import { PlatformIcon } from "@/components/platform-icon";
import type { Snapshot } from "@/lib/workspaces/contracts";

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
    <div className="tw-content">
      {snapshot.variants.map((v) => (
        <section key={v.platform} className="tw-variant">
          <h3>
            <PlatformIcon platform={v.platform} /> {platformName[v.platform]}
          </h3>
          <small>
            {v.destination?.label ?? "Native publishing"}
            {Object.values(v.options).map((val) => ` · ${val}`)}
          </small>
          <p>{v.caption}</p>
          <div className="tw-gallery">
            {v.fileIds.map((id, i) => {
              const file = w.files.find((f) => f.id === id);
              if (!file) return null;
              const url = `/api/v1/workspaces/${w.id}/files/${id}`;
              return (
                <figure key={i}>
                  {file.mime.startsWith("video/") ? (
                    <video controls preload="metadata" src={url} aria-label={file.filename} />
                  ) : (
                    <img src={url} alt={file.filename} />
                  )}
                  <figcaption>
                    <a href={url} download={file.filename}>
                      {file.filename}
                    </a>
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>
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
    <article className="tw-detail">
      <header>
        <span className="tw-state" data-kind={state.kind}>
          {state.name}
        </span>
        <h2>{snapshot.title}</h2>
        <div className="tw-meta">
          <span>
            Planned <b>{displayDate(snapshot.plannedAt)}</b>
          </span>
          <span>
            Owner <b>{w.members.find((m) => m.userId === p.ownerId)?.user.name ?? "Unassigned"}</b>
          </span>
          <span>
            Due <b>{p.dueAt ? displayDate(p.dueAt) : "No deadline"}</b>
          </span>
          {review && (
            <span>
              Review version <b>{p.reviews.length - p.reviews.indexOf(review)}</b>
            </span>
          )}
        </div>
      </header>
      <Content workspace={w} snapshot={snapshot} />
      <div className="tw-line tw-actions">
        {editor && !queue && <button onClick={edit}>Edit post</button>}
        {editor && !p.deliveredAt && !pending && state.kind !== "approved" && (
          <button
            className="primary"
            onClick={() => void run({ action: "submit", postId: p.id, revision: p.revision })}>
            Submit for review
          </button>
        )}
        {editor && !queue && !p.deliveredAt && (
          <label>
            Move to{" "}
            <select
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
            </select>
          </label>
        )}
        {w.member.approver && pending && (
          <>
            <button
              className="primary"
              onClick={() =>
                void run({ action: "decide", postId: p.id, reviewId: review.id, outcome: "approved", body: "" })
              }>
              Approve
            </button>
            <button onClick={() => setRequesting(!requesting)}>Request changes</button>
          </>
        )}
        {editor &&
          !p.deliveredAt &&
          state.kind === "approved" &&
          review &&
          (!connected || w.creatorId === w.member.userId) && (
            <button
              className="primary"
              onClick={() => void run({ action: "release", postId: p.id, reviewId: review.id })}>
              {connected ? "Schedule with SimplePost" : "Mark as published natively"}
            </button>
          )}
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
          onSubmit={async (e) => {
            e.preventDefault();
            if (
              await run({ action: "decide", postId: p.id, reviewId: review.id, outcome: "changes", body: feedback })
            ) {
              setFeedback("");
              setRequesting(false);
            }
          }}>
          <label>
            Requested changes
            <textarea autoFocus value={feedback} maxLength={4000} onChange={(e) => setFeedback(e.target.value)} />
          </label>
          <button type="submit">Send change request</button>
        </form>
      )}
      <section className="tw-history">
        <h3>Discussion and activity</h3>
        {p.events.map((event) => (
          <div key={event.id}>
            <strong>{event.actorName}</strong> {activity[event.kind] ?? event.kind}
            <small>{displayDate(event.createdAt)}</small>
            {event.body && <p>{event.body}</p>}
          </div>
        ))}
        {(editor || w.member.approver) && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run({ action: "comment", postId: p.id, body: comment })) setComment("");
            }}>
            <label>
              Add a comment
              <textarea required maxLength={4000} value={comment} onChange={(e) => setComment(e.target.value)} />
            </label>
            <button disabled={!comment.trim()}>Post comment</button>
          </form>
        )}
      </section>
      {p.reviews.length > 0 && (
        <section>
          <h3>Review history</h3>
          {p.reviews.map((r, i) => (
            <details key={r.id}>
              <summary>
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
