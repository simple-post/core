"use client";
import { useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFeatures } from "@/hooks/use-features";
import { useSession } from "@/lib/auth/auth-client";

import { json, request, type WorkspaceIndex } from "./types";

export function workspaceHref(path: string, id?: string | null) {
  return id ? `${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(id)}` : path;
}
export function useWorkspaceIndex() {
  const id = useSearchParams()?.get("workspace");
  const { data: session } = useSession();
  const { hasFeature, isPending: featuresPending } = useFeatures();
  const enabled = hasFeature("TEAM_WORKSPACES");
  const query = useQuery({
    queryKey: ["workspaces", session?.user.id],
    enabled,
    queryFn: () => request<WorkspaceIndex>("/api/v1/workspaces"),
  });
  const data = enabled ? query.data : undefined;
  return {
    id,
    data,
    pending: featuresPending || (enabled && query.isPending),
    indexError: query.error,
    current: data?.workspaces.find((w) => w.id === id),
    refresh: query.refetch,
  };
}

export function WorkspaceSwitcher() {
  const { id, data, refresh } = useWorkspaceIndex();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  if (!data || (!data.limit && data.workspaces.length === 0 && data.invites.length === 0)) return null;
  const current = data.workspaces.find((w) => w.id === id);
  async function submit(body: object) {
    setBusy(true);
    setError("");
    try {
      const workspace = await request<{ id: string }>("/api/v1/workspaces", json(body));
      await refresh();
      setCreating(false);
      router.push(workspaceHref("/", workspace.id));
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not update workspace");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Switch workspace: ${current?.name ?? "Personal"}`}
            className="min-w-0 gap-1">
            <span className="max-w-24 truncate sm:max-w-44">{current?.name ?? "Personal"}</span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => router.push("/")}>
            Personal workspace {!id && <Check className="ms-auto" />}
          </DropdownMenuItem>
          {data.workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => router.push(workspaceHref("/", w.id))}>
              {w.name}
              {id === w.id && <Check className="ms-auto" />}
            </DropdownMenuItem>
          ))}
          {data.invites.map((i) => (
            <DropdownMenuItem
              disabled={busy}
              key={i.id}
              onSelect={() => void submit({ action: "accept", workspaceId: i.workspaceId, inviteId: i.id })}>
              Join {i.workspace.name}
            </DropdownMenuItem>
          ))}
          {current?.role === "Admin" && (
            <DropdownMenuItem onSelect={() => router.push(workspaceHref("/?tab=settings", current.id))}>
              Workspace settings
            </DropdownMenuItem>
          )}
          {data.owned < data.limit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setError("");
                  setCreating(true);
                }}>
                <Plus />
                Create workspace
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {!creating && error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit({ name: new FormData(e.currentTarget).get("name"), icon: "◉", description: "" });
            }}>
            <Label className="flex-col items-stretch">
              Workspace name
              <Input name="name" maxLength={80} required autoFocus />
            </Label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button disabled={busy}>Create workspace</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
