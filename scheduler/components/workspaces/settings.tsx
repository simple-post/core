import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { roles } from "@/lib/workspaces/contracts";

import type { Run, Workspace } from "./types";
type Role = (typeof roles)[number];
export function TeamSettings({ workspace: w, run }: { workspace: Workspace; run: Run }) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card className="gap-4 px-4 sm:px-6">
        <h2 className="text-lg font-semibold tracking-tight">Workspace settings</h2>
        <form
          className="space-y-4"
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
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-4">
            <Label className="min-w-0 flex-col items-stretch">
              Icon
              <Input name="icon" required maxLength={12} defaultValue={w.icon} />
            </Label>
            <Label className="min-w-0 flex-col items-stretch">
              Name
              <Input name="name" required maxLength={80} defaultValue={w.name} />
            </Label>
          </div>
          <Label className="min-w-0 flex-col items-stretch">
            Description
            <Textarea name="description" defaultValue={w.description} maxLength={500} />
          </Label>
          <Button size="sm">Save settings</Button>
        </form>
      </Card>
      <Card className="gap-4 px-4 sm:px-6">
        <h2 className="text-lg font-semibold tracking-tight">Members</h2>
        {w.members.map((m) => (
          <div
            key={m.userId}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 last:border-0 [&>input]:w-auto [&>input]:max-w-full">
            <div className="min-w-0 break-words">
              <span className="text-sm font-medium">{m.user.name}</span>
              <small className="block text-xs text-muted-foreground">{m.user.email}</small>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <NativeSelect
                aria-label={`Role for ${m.user.name}`}
                disabled={m.userId === w.creatorId}
                value={m.role}
                onChange={(e) =>
                  void run({ action: "member", userId: m.userId, role: e.target.value as Role, approver: m.approver })
                }>
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </NativeSelect>
              <Label className="shrink-0">
                <input
                  className="size-4 accent-primary"
                  type="checkbox"
                  checked={m.approver}
                  onChange={(e) =>
                    void run({ action: "member", userId: m.userId, role: m.role as Role, approver: e.target.checked })
                  }
                />
                Approver
              </Label>
              {m.userId !== w.creatorId && (
                <Button variant="outline" size="sm" onClick={() => void run({ action: "remove", userId: m.userId })}>
                  Remove
                </Button>
              )}
            </div>
          </div>
        ))}
        <form
          className="space-y-4"
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
          <h3 className="flex items-center gap-2 text-sm font-semibold">Invite a teammate</h3>
          <div className="flex flex-wrap items-end gap-3">
            <Label className="min-w-0 flex-col items-stretch">
              Email
              <Input required name="email" type="email" />
            </Label>
            <Label className="min-w-0 flex-col items-stretch">
              Role
              <NativeSelect name="role" defaultValue="Editor">
                {roles.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </NativeSelect>
            </Label>
            <Label className="shrink-0">
              <input className="size-4 accent-primary" type="checkbox" name="approver" />
              Approver
            </Label>
            <Button variant="outline" size="sm">
              Create invitation
            </Button>
          </div>
        </form>
        {w.invites.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              Invitations expire after seven days. Only accounts with workspace pilot access can see and accept them.
            </p>
            {w.invites.map((i) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 last:border-0 [&>input]:w-auto [&>input]:max-w-full"
                key={i.id}>
                <span>
                  {i.email} · {i.role}
                </span>
                <Button variant="outline" size="sm" onClick={() => void run({ action: "revoke", inviteId: i.id })}>
                  Revoke
                </Button>
              </div>
            ))}
          </>
        )}
      </Card>
      <Card className="gap-4 px-4 sm:px-6">
        <h2 className="text-lg font-semibold tracking-tight">Editorial states</h2>
        {w.states.map((s) => (
          <form
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 last:border-0 [&>input]:w-auto [&>input]:max-w-full"
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
                <small className="block text-xs text-muted-foreground">Protected final state</small>
              </>
            ) : (
              <>
                <Input name="name" aria-label={`State name for ${s.name}`} required defaultValue={s.name} />
                {s.kind === "custom" && (
                  <Input
                    type="number"
                    name="position"
                    aria-label="Sort position"
                    min="1"
                    max="999"
                    defaultValue={s.position}
                  />
                )}
                <Button variant="outline" size="sm">
                  Save
                </Button>
                {s.kind === "custom" && (
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => void run({ action: "deleteState", stateId: s.id })}>
                    Remove
                  </Button>
                )}
              </>
            )}
          </form>
        ))}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const f = e.currentTarget;
            const d = new FormData(f);
            if (
              await run({ action: "state", name: String(d.get("name")), position: Math.min(999, 20 + w.states.length) })
            )
              f.reset();
          }}>
          <Label className="min-w-0 flex-col items-stretch">
            New state
            <Input name="name" required maxLength={80} />
          </Label>
          <Button variant="outline" size="sm">
            Add state
          </Button>
        </form>
      </Card>
      {w.files.length > 0 && (
        <Card className="gap-4 px-4 sm:px-6">
          <h2 className="text-lg font-semibold tracking-tight">Workspace files</h2>
          <p className="text-sm text-muted-foreground">
            Post attachments and reviewed files are retained. Remove unused uploads to free space.
          </p>
          {w.files.map((file) => (
            <div
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 last:border-0 [&>input]:w-auto [&>input]:max-w-full">
              <span>{file.filename}</span>
              <Button variant="outline" size="sm" onClick={() => void run({ action: "removeFile", fileId: file.id })}>
                Remove unused file
              </Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
