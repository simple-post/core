"use client";

import { useState } from "react";

import { ArrowDown, ArrowUp, GripVertical, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { Run, Workspace } from "./types";

type DraftState = { key: string; id?: string; name: string; kind: string };
type WorkflowSnapshot = { id: string; name: string; position: number }[];

export function WorkflowSettings({ workspace, run }: { workspace: Workspace; run: Run }) {
  const saved = workspace.states
    .filter((state) => state.kind !== "approved")
    .map((state) => ({ ...state, key: state.id }));
  const [draft, setDraft] = useState<{ items: DraftState[]; expected: WorkflowSnapshot }>();
  const [dragging, setDragging] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const [saveError, setSaveError] = useState(false);
  const items = draft?.items ?? saved;
  const inUse = new Set(workspace.posts.map((post) => post.stateId));

  function update(items: DraftState[]) {
    setDraft({
      items,
      expected: draft?.expected ?? workspace.states.map(({ id, name, position }) => ({ id, name, position })),
    });
    setSaveError(false);
  }

  function move(from: number, to: number) {
    if (from < 0 || to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    update(next);
  }

  return (
    <Card id="workflow" className="scroll-mt-20 gap-4 px-5 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Approval workflow</h2>
          <p className="mt-1 text-sm text-muted-foreground">Drag states to reorder them. Save when you’re done.</p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => update([...items, { key: crypto.randomUUID(), name: "", kind: "custom" }])}>
          <Plus className="size-4" aria-hidden /> Add state
        </Button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft) return;
          const saved = await run({
            action: "workflow",
            expected: draft.expected,
            states: draft.items.map(({ id, name }) => ({ id, name })),
          });
          setSaveError(!saved);
          if (saved) {
            setDraft(undefined);
            toast.success("Workflow saved");
          }
        }}>
        <ol className="divide-y overflow-hidden rounded-xl border border-border">
          {items.map((state, index) => (
            <li
              key={state.key}
              className={cn("flex items-center gap-1.5 p-2 sm:gap-2", dropTarget === state.key && "bg-accent")}
              onDragOver={(event) => {
                if (!dragging) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(state.key);
              }}
              onDrop={(event) => {
                event.preventDefault();
                move(
                  items.findIndex((item) => item.key === dragging),
                  index,
                );
                setDragging(undefined);
                setDropTarget(undefined);
              }}>
              <span
                className="hidden cursor-grab px-1 text-muted-foreground active:cursor-grabbing sm:inline-flex"
                draggable
                aria-hidden
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", state.key);
                  setDragging(state.key);
                }}
                onDragEnd={() => {
                  setDragging(undefined);
                  setDropTarget(undefined);
                }}>
                <GripVertical className="size-4" />
              </span>
              <Input
                value={state.name}
                maxLength={80}
                required
                placeholder="State name"
                aria-label={`State ${index + 1}`}
                className="h-8 min-w-0 bg-transparent"
                onChange={(event) =>
                  update(items.map((item) => (item.key === state.key ? { ...item, name: event.target.value } : item)))
                }
              />
              <div className="flex shrink-0 items-center">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Move ${state.name || "new state"} up`}
                  disabled={index === 0}
                  onClick={() => move(index, index - 1)}>
                  <ArrowUp className="size-3.5" aria-hidden />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-7"
                  aria-label={`Move ${state.name || "new state"} down`}
                  disabled={index === items.length - 1}
                  onClick={() => move(index, index + 1)}>
                  <ArrowDown className="size-3.5" aria-hidden />
                </Button>
                {state.kind === "custom" ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive"
                    aria-label={`Delete ${state.name || "new state"}`}
                    disabled={state.id ? inUse.has(state.id) : false}
                    title={
                      state.id && inUse.has(state.id)
                        ? "Move its posts to another state before deleting"
                        : "Delete state"
                    }
                    onClick={() => update(items.filter((item) => item.key !== state.key))}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                ) : (
                  <span className="size-7" aria-hidden />
                )}
              </div>
            </li>
          ))}
          <li className="flex items-center gap-2.5 bg-muted/30 p-3 text-sm">
            <LockKeyhole className="size-4 text-muted-foreground" aria-hidden />
            <span className="font-medium">Approved</span>
            <span className="ms-auto text-xs text-muted-foreground">Final state</span>
          </li>
        </ol>
        {saveError && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            The workflow could not be saved. Your edits are still here.
          </p>
        )}
        <div className="mt-4 flex items-center justify-end gap-2">
          {draft && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(undefined);
                setSaveError(false);
              }}>
              Discard changes
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!draft}>
            Save workflow
          </Button>
        </div>
      </form>
    </Card>
  );
}
