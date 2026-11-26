"use client";
import { useState } from "react";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Plus, Settings } from "lucide-react";

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
import { useWorkspaceScope } from "@/hooks/use-workspace-scope";
import { useSession } from "@/lib/auth/auth-client";
import { cn } from "@/lib/utils";
import { workspaceColorStyle } from "@/lib/workspaces/colors";

import { json, request, type WorkspaceIndex } from "./types";

export function workspaceHref(path: string, id?: string | null) {
  return id ? `${path}${path.includes("?") ? "&" : "?"}workspace=${encodeURIComponent(id)}` : path;
}
export function useWorkspaceIndex() {
  const { id, requested, enabled, isPending: featuresPending } = useWorkspaceScope();
  const { data: session } = useSession();
  const query = useQuery({
    queryKey: ["workspaces", session?.user.id],
    enabled,
    queryFn: () => request<WorkspaceIndex>("/api/v1/workspaces"),
  });
  const data = enabled ? query.data : undefined;
  return {
    id,
    requested,
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
  const pathname = usePathname();
  if (!data) return null;
  const current = data.workspaces.find((w) => w.id === id);
  const active = current ?? data.personal;
  const switchPath = ["/accounts", "/analytics", "/inbox", "/workspaces/settings"].includes(pathname) ? pathname : "/";
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
      <div className="flex min-w-0 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Switch workspace: ${active?.name ?? "Personal"}`}
              className="min-w-0 gap-1.5 px-1.5 sm:px-2">
              <span
                aria-hidden
                className={cn("size-2.5 shrink-0 rounded-full", workspaceColorStyle[active?.color ?? "slate"]?.swatch)}
              />
              <span className="max-w-24 truncate sm:max-w-44">{active?.name ?? "Personal"}</span>
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => router.push(switchPath)}>
              <span
                aria-hidden
                className={cn("size-2.5 rounded-full", workspaceColorStyle[data.personal?.color ?? "slate"]?.swatch)}
              />
              {data.personal?.name ?? "Personal"} {!id && <Check className="ms-auto" />}
            </DropdownMenuItem>
            {data.workspaces.map((w) => (
              <DropdownMenuItem key={w.id} onSelect={() => router.push(workspaceHref(switchPath, w.id))}>
                <span aria-hidden className={cn("size-2.5 rounded-full", workspaceColorStyle[w.color]?.swatch)} />
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
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setError("");
                setCreating(true);
              }}>
              <Plus />
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button asChild size="icon" variant="ghost" className="size-8 shrink-0 text-muted-foreground">
          <Link
            href={workspaceHref("/workspaces/settings", current?.id)}
            aria-label="Workspace settings"
            title="Workspace settings"
            aria-current={pathname === "/workspaces/settings" ? "page" : undefined}>
            <Settings className="size-4" aria-hidden />
          </Link>
        </Button>
      </div>
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
