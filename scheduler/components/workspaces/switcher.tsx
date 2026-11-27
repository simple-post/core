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
import { DEFAULT_PERSONAL_WORKSPACE_NAME, workspaceColorHex } from "@/lib/workspaces/colors";

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
    enabled,
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Switch workspace: ${active?.name ?? DEFAULT_PERSONAL_WORKSPACE_NAME}`}
            className="min-w-0 gap-1.5 px-1.5 sm:px-2">
            <WorkspaceDot color={active?.color} />
            <span className="max-w-14 truncate min-[375px]:max-w-24 sm:max-w-44">
              {active?.name ?? DEFAULT_PERSONAL_WORKSPACE_NAME}
            </span>
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <WorkspaceMenuRow
            name={data.personal.name}
            color={data.personal.color}
            logo={data.personal.logo}
            active={!id}
            select={() => router.push(switchPath)}
            settingsHref="/workspaces/settings"
          />
          {data.workspaces.map((w) => (
            <WorkspaceMenuRow
              key={w.id}
              name={w.name}
              color={w.color}
              logo={w.logo}
              active={id === w.id}
              select={() => router.push(workspaceHref(switchPath, w.id))}
              settingsHref={w.role === "Admin" ? workspaceHref("/workspaces/settings", w.id) : undefined}
            />
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
            <Plus /> Create workspace
          </DropdownMenuItem>
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

function WorkspaceDot({ color }: { color?: string }) {
  const accent = workspaceColorHex(color);
  return accent && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: accent }} />;
}

function WorkspaceMenuRow({
  name,
  color,
  logo,
  active,
  select,
  settingsHref,
}: {
  name: string;
  color: string;
  logo?: string | null;
  active: boolean;
  select: () => void;
  settingsHref?: string;
}) {
  return (
    <div role="group" aria-label={name} className="flex items-stretch gap-0.5">
      <DropdownMenuItem onSelect={select} className="min-w-0 flex-1 cursor-pointer">
        {logo && <img src={logo} alt="" className="size-4 rounded-sm object-cover" />}
        <WorkspaceDot color={color} />
        <span className="truncate">{name}</span>
        {active && <Check className="ms-auto shrink-0" aria-hidden />}
      </DropdownMenuItem>
      {settingsHref && (
        <DropdownMenuItem asChild className="cursor-pointer px-2.5">
          <Link href={settingsHref} aria-label={`Settings for ${name}`} title={`Settings for ${name}`}>
            <Settings className="size-4" aria-hidden />
          </Link>
        </DropdownMenuItem>
      )}
    </div>
  );
}
