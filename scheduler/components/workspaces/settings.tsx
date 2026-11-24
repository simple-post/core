import { roles } from "@/lib/workspaces/contracts";

import type { Run, Workspace } from "./types";
type Role = (typeof roles)[number];
export function TeamSettings({ workspace: w, run }: { workspace: Workspace; run: Run }) {
  return (
    <div className="tw-settings">
      <section>
        <h2>Workspace settings</h2>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            await run({
              action: "settings",
              name: String(data.get("name")),
              icon: String(data.get("icon")),
              description: String(data.get("description")),
            });
          }}>
          <div className="tw-fields">
            <label>
              Icon
              <input name="icon" required maxLength={12} defaultValue={w.icon} />
            </label>
            <label>
              Name
              <input name="name" required maxLength={80} defaultValue={w.name} />
            </label>
          </div>
          <label>
            Description
            <textarea name="description" defaultValue={w.description} maxLength={500} />
          </label>
          <button>Save settings</button>
        </form>
      </section>
      <section>
        <h2>Members</h2>
        {w.members.map((m) => (
          <div key={m.userId} className="tw-row">
            <div>
              <b>{m.user.name}</b>
              <small>{m.user.email}</small>
            </div>
            <div className="tw-line">
              <select
                aria-label={`Role for ${m.user.name}`}
                disabled={m.userId === w.creatorId}
                value={m.role}
                onChange={(e) =>
                  void run({ action: "member", userId: m.userId, role: e.target.value as Role, approver: m.approver })
                }>
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
              <label className="tw-check">
                <input
                  type="checkbox"
                  checked={m.approver}
                  onChange={(e) =>
                    void run({ action: "member", userId: m.userId, role: m.role as Role, approver: e.target.checked })
                  }
                />
                Approver
              </label>
              {m.userId !== w.creatorId && (
                <button onClick={() => void run({ action: "remove", userId: m.userId })}>Remove</button>
              )}
            </div>
          </div>
        ))}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const d = new FormData(form);
            if (
              await run({
                action: "invite",
                email: String(d.get("email")),
                role: d.get("role") as Role,
                approver: d.has("approver"),
              })
            )
              form.reset();
          }}>
          <h3>Invite a teammate</h3>
          <div className="tw-line">
            <label>
              Email
              <input required name="email" type="email" />
            </label>
            <label>
              Role
              <select name="role" defaultValue="Editor">
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="tw-check">
              <input type="checkbox" name="approver" />
              Approver
            </label>
            <button>Create invitation</button>
          </div>
        </form>
        {w.invites.length > 0 && (
          <>
            <p>
              Ask invited teammates to sign in at <a href="/workspaces">/workspaces</a> with their verified email.
              Invitations expire after seven days.
            </p>
            {w.invites.map((i) => (
              <div className="tw-row" key={i.id}>
                <span>
                  {i.email} · {i.role}
                </span>
                <button onClick={() => void run({ action: "revoke", inviteId: i.id })}>Revoke</button>
              </div>
            ))}
          </>
        )}
      </section>
      <section>
        <h2>Editorial states</h2>
        {w.states.map((s) => (
          <form
            key={s.id}
            className="tw-row"
            onSubmit={async (e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              await run({
                action: "state",
                stateId: s.id,
                name: String(d.get("name")),
                position: Number(d.get("position") ?? 10),
              });
            }}>
            {s.kind === "approved" ? (
              <>
                <b>Approved</b>
                <small>Protected final state</small>
              </>
            ) : (
              <>
                <input name="name" aria-label={`State name for ${s.name}`} required defaultValue={s.name} />
                {s.kind === "custom" && (
                  <input
                    type="number"
                    name="position"
                    aria-label="Sort position"
                    min="1"
                    max="999"
                    defaultValue={s.position}
                  />
                )}
                <button>Save</button>
                {s.kind === "custom" && (
                  <button type="button" onClick={() => void run({ action: "deleteState", stateId: s.id })}>
                    Remove
                  </button>
                )}
              </>
            )}
          </form>
        ))}
        <form
          className="tw-line"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const d = new FormData(f);
            if (
              await run({ action: "state", name: String(d.get("name")), position: Math.min(999, 20 + w.states.length) })
            )
              f.reset();
          }}>
          <label>
            New state
            <input name="name" required maxLength={80} />
          </label>
          <button>Add state</button>
        </form>
      </section>
      {w.files.length > 0 && (
        <section>
          <h2>Workspace files</h2>
          <p>Post attachments and reviewed files are retained. Remove unused uploads to free space.</p>
          {w.files.map((file) => (
            <div key={file.id} className="tw-row">
              <span>{file.filename}</span>
              <button onClick={() => void run({ action: "removeFile", fileId: file.id })}>Remove unused file</button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
