"use client";

import { useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useWorkspaceIndex, workspaceHref } from "@/components/workspaces/switcher";
import { json, request } from "@/components/workspaces/types";

export default function WorkspaceInvitationPage() {
  const { data, pending, refresh } = useWorkspaceIndex();
  const search = useSearchParams();
  const router = useRouter();
  const invite = data?.invites.find(
    (item) => item.id === search.get("invite") && item.workspaceId === search.get("team"),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function accept() {
    if (!invite || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ id: string }>(
        "/api/v1/workspaces",
        json({
          action: "accept",
          workspaceId: invite.workspaceId,
          inviteId: invite.id,
        }),
      );
      await refresh();
      router.replace(workspaceHref("/", result.id));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not accept the invitation.");
      setBusy(false);
    }
  }
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-lg px-5 py-10">
        <Card className="gap-4 p-6">
          <h1 className="text-xl font-semibold">{invite ? `Join ${invite.workspace.name}` : "Workspace invitation"}</h1>
          {pending ? (
            <p role="status">Loading invitation…</p>
          ) : invite ? (
            <Button disabled={busy} onClick={() => void accept()}>
              Accept invitation
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">
              This invitation is unavailable. Sign in with the invited email address and workspace access.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </Card>
      </main>
    </>
  );
}
