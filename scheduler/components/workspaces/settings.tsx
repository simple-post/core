"use client";

import { useState } from "react";

import { Mail, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceColor } from "@/lib/workspaces/colors";
import { roles } from "@/lib/workspaces/contracts";

import { WorkspaceColorPicker, WorkspaceLogoPicker, workspaceLogoInput } from "./appearance";
import { WorkflowSettings } from "./workflow-settings";

import type { Member, Run, Workspace } from "./types";
type Role = (typeof roles)[number];
export function TeamSettings({
  workspace: w,
  run,
  busy,
  actionError,
}: {
  workspace: Workspace;
  run: Run;
  busy: boolean;
  actionError: string;
}) {
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState(false);
  const [removing, setRemoving] = useState<Member>();
  const [removeError, setRemoveError] = useState(false);
  const adminCount = w.members.filter((member) => member.role === "Admin").length;
  const removingOwner = removing?.userId === w.creatorId;
  return (
    <div className="space-y-5">
      <Card id="general" className="scroll-mt-20 gap-4 px-5 sm:px-6">
        <h2 className="text-lg font-semibold tracking-tight">General</h2>
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const data = new FormData(e.currentTarget);
            try {
              if (
                await run({
                  action: "settings",
                  name: String(data.get("name")),
                  icon: w.icon,
                  color: data.get("color") as WorkspaceColor,
                  description: String(data.get("description")),
                  logo: await workspaceLogoInput(data),
                })
              )
                toast.success("Workspace settings saved");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not save workspace settings.");
            }
          }}>
          <Label className="max-w-sm flex-col items-stretch">
            Workspace name
            <Input name="name" required maxLength={80} defaultValue={w.name} />
          </Label>
          <WorkspaceColorPicker color={w.color} />
          <WorkspaceLogoPicker logo={w.logo} />
          <Label className="min-w-0 flex-col items-stretch">
            Description
            <Textarea name="description" defaultValue={w.description} maxLength={500} />
          </Label>
          <Button size="sm">Save changes</Button>
        </form>
      </Card>
      <Card id="members" className="scroll-mt-20 gap-4 px-5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Members</h2>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setInviteError(false);
              setInviting(true);
            }}>
            <UserPlus className="size-4" aria-hidden /> Invite member
          </Button>
        </div>
        {w.members.map((m) => (
          <div
            key={m.userId}
            className="grid items-center gap-3 border-b border-border pb-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0 break-words">
              <span className="text-sm font-medium">{m.user.name || m.user.email}</span>
              {m.user.name && <small className="block text-xs text-muted-foreground">{m.user.email}</small>}
            </div>
            <div className="grid grid-cols-[6rem_6.5rem_4.5rem] items-center gap-2">
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
              <Button
                variant="ghost"
                size="icon"
                type="button"
                className="size-8 justify-self-end text-destructive"
                disabled={m.role === "Admin" && adminCount < 2}
                title={m.role === "Admin" && adminCount < 2 ? "Add another admin first" : "Remove member"}
                aria-label={`Remove ${m.user.name || m.user.email} from workspace`}
                onClick={() => {
                  setRemoveError(false);
                  setRemoving(m);
                }}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        {w.invites.map((invite) => (
          <div
            key={invite.id}
            className="grid items-center gap-3 border-b border-border pb-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="text-sm font-medium wrap-anywhere">{invite.email}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {invite.role}
                {invite.approver ? " · Approver" : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
                Invited
              </span>
              {!invite.emailSentAt && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void run({ action: "resendInvite", inviteId: invite.id })}>
                  <Mail className="size-3.5" aria-hidden /> Send email
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 text-destructive"
                title="Delete invitation"
                aria-label={`Delete invitation for ${invite.email}`}
                onClick={() => void run({ action: "revoke", inviteId: invite.id })}>
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        <Dialog
          open={Boolean(removing)}
          onOpenChange={(open) => {
            if (!open) setRemoving(undefined);
          }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Remove {removing?.user.name || removing?.user.email}?</DialogTitle>
              <DialogDescription>
                {removingOwner
                  ? "Another admin will take ownership of this workspace and manage its connected accounts."
                  : "This member will lose access to the workspace."}
              </DialogDescription>
            </DialogHeader>
            {removeError && (
              <p role="alert" className="text-sm text-destructive">
                {actionError || "Could not remove this member. Reload the workspace and try again."}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={async () => {
                  if (!removing || busy) return;
                  setRemoveError(false);
                  if (await run({ action: "remove", userId: removing.userId })) setRemoving(undefined);
                  else setRemoveError(true);
                }}>
                Remove member
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog open={inviting} onOpenChange={setInviting}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>
                Send an email invitation to join {w.name}. It expires after seven days.
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                setInviteError(false);
                if (
                  await run({
                    action: "invite",
                    email: String(form.get("email")),
                    role: form.get("role") as Role,
                    approver: form.has("approver"),
                  })
                )
                  setInviting(false);
                else setInviteError(true);
              }}>
              <Label className="flex-col items-stretch">
                Email
                <Input required name="email" type="email" autoComplete="email" maxLength={254} />
              </Label>
              <Label className="flex-col items-stretch">
                Role
                <NativeSelect name="role" defaultValue="Editor">
                  {roles.map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </NativeSelect>
              </Label>
              <Label>
                <input className="size-4 accent-primary" type="checkbox" name="approver" /> Can approve posts
              </Label>
              {inviteError && (
                <p role="alert" className="text-sm text-destructive">
                  Could not create the invitation. Check the email address and try again.
                </p>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={busy}>
                  Send invitation
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </Card>
      <WorkflowSettings workspace={w} run={run} />
      {w.files.length > 0 && (
        <Card id="files" className="scroll-mt-20 gap-4 px-5 sm:px-6">
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
