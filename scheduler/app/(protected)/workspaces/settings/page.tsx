"use client";

import { useState } from "react";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceColorPicker, WorkspaceSettingsLayout } from "@/components/workspaces/settings-layout";
import { useWorkspaceIndex } from "@/components/workspaces/switcher";
import { TeamScreen } from "@/components/workspaces/team-screen";
import { json, request } from "@/components/workspaces/types";

export default function WorkspaceSettingsPage() {
  const { id, requested, pending, data, refresh } = useWorkspaceIndex();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (id) return <TeamScreen key={id} id={id} view="settings" />;
  const personal = !requested && data?.personal;
  return (
    <WorkspaceSettingsLayout
      name={personal ? personal.name : undefined}
      color={personal ? personal.color : undefined}
      sections={[{ id: "general", label: "General" }]}>
      {personal ? (
        <Card id="general" className="scroll-mt-20 gap-4 px-5 sm:px-6">
          <div>
            <h2 className="text-lg font-semibold">General</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose how your personal workspace appears in the switcher.
            </p>
          </div>
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setBusy(true);
              setError("");
              try {
                await request(
                  "/api/v1/workspaces",
                  json({ action: "personalSettings", name: data.get("name"), color: data.get("color") }),
                );
                await refresh();
                toast.success("Workspace settings saved");
              } catch (error) {
                setError(error instanceof Error ? error.message : "Could not save workspace settings.");
              } finally {
                setBusy(false);
              }
            }}>
            <Label className="max-w-sm flex-col items-stretch">
              Workspace name
              <Input defaultValue={personal.name} name="name" maxLength={80} required />
            </Label>
            <WorkspaceColorPicker color={personal.color} />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <Button type="submit" size="sm" disabled={busy}>
              Save changes
            </Button>
          </form>
        </Card>
      ) : (
        <p role="status">{pending ? "Loading workspace…" : "Workspace unavailable."}</p>
      )}
    </WorkspaceSettingsLayout>
  );
}
