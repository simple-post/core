"use client";
import { useState, type ReactNode } from "react";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardCheck, Settings2, Plus, ArrowLeft, ChevronDown, Check } from "lucide-react";

import { Navbar } from "@/components/navbar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PostStatusTabs } from "@/components/visual/post-status-tabs";
import { PlannerCalendar } from "@/components/workspaces/calendar";
import { PostDetail } from "@/components/workspaces/detail";
import { PostEditor } from "@/components/workspaces/editor";
import { TeamSettings } from "@/components/workspaces/settings";
import { json, request, type Workspace, type WorkspaceIndex, type Run } from "@/components/workspaces/types";

const base = "/api/v1/workspaces";
function Team({ id, refreshIndex, switcher }: { id: string; switcher: ReactNode; refreshIndex: () => void }) {
  const query = useQuery({
    queryKey: ["team-planner", id],
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: () => request<Workspace>(base + "/" + id),
  });
  const [requestedTab, setTab] = useState("Calendar");
  const [selected, setSelected] = useState("");
  const [plannedDay, setPlannedDay] = useState<Date>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run: Run = async (cmd) => {
    setError("");
    setBusy(true);
    try {
      const result = await request<{ id: string | null }>(base + "/" + id, json(cmd));
      await query.refetch({ throwOnError: true });
      if (cmd.action === "settings") refreshIndex();
      if (cmd.action === "createPost" && result.id) setSelected(result.id);
      return true;
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Could not save changes");
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (query.isError)
    return (
      <>
        {" "}
        {switcher}
        <p role="alert" className="my-3 text-sm text-destructive">
          {query.error.message}{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      </>
    );
  const w = query.data;
  if (!w) return <p>Loading workspace…</p>;
  const tab = requestedTab === "Settings" && w.member.role !== "Admin" ? "Calendar" : requestedTab;
  const item = w.posts.find((p) => p.id === selected);
  const queue = w.posts.filter((p) => p.stateId === w.states.find((s) => s.kind === "review")?.id);
  const tabs = [
    { name: "Calendar", icon: CalendarDays },
    { name: "Approvals", icon: ClipboardCheck },
    ...(w.member.role === "Admin" ? [{ name: "Settings", icon: Settings2 }] : []),
  ];
  function newPost(day?: Date) {
    setPlannedDay(day);
    setSelected("");
    setEditing(true);
    setTab("Calendar");
  }
  const reviewPost = queue.find((p) => p.id === selected) ?? queue[0];
  return (
    <>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="section-kicker !mb-0">
              <span className="section-kicker-dot" />
              <span className="section-kicker-label">Workspace</span>
            </div>
            <span className="hidden h-3 w-px bg-border sm:block" />
            {switcher}
          </div>
          {w.description && <p className="mt-2 break-words text-sm text-muted-foreground">{w.description}</p>}
        </div>
        {w.member.role !== "Viewer" && (
          <Button size="sm" onClick={() => newPost()}>
            <Plus />
            New post
          </Button>
        )}
      </header>
      <Tabs
        value={tab}
        onValueChange={(name) => {
          setTab(name);
          setSelected("");
          setEditing(false);
          setError("");
        }}>
        <PostStatusTabs
          ariaLabel="Workspace views"
          items={tabs.map(({ name, icon: Icon }) => ({
            id: name,
            label: name,
            icon: <Icon className="size-3.5" />,
            badge:
              name === "Approvals" ? (
                <span className="hidden rounded-full bg-secondary px-1.5 text-[10px] sm:inline-flex tracking-normal text-muted-foreground">
                  {queue.length}
                </span>
              ) : undefined,
          }))}
        />
        <TabsContent value={tab}>
          {error && (
            <p role="alert" className="mb-3 text-sm text-destructive">
              {error}{" "}
              <button
                className="underline"
                onClick={() => {
                  void query.refetch();
                  setEditing(false);
                  setError("");
                }}>
                Reload workspace
              </button>
            </p>
          )}
          <fieldset disabled={busy} className="min-w-0" aria-busy={busy}>
            {tab === "Settings" ? (
              <TeamSettings workspace={w} run={run} />
            ) : tab === "Approvals" ? (
              <section>
                <div className="mb-4 flex flex-wrap items-baseline gap-2">
                  <h2 className="text-lg font-semibold tracking-tight">Approval feed</h2>
                  <span className="text-sm text-muted-foreground">{queue.length} awaiting review</span>
                </div>
                {reviewPost ? (
                  <div className="grid items-start gap-4 md:grid-cols-[minmax(12rem,15rem)_minmax(0,1fr)]">
                    <Label className="flex-col items-stretch md:hidden">
                      Post to review
                      <NativeSelect value={reviewPost.id} onChange={(e) => setSelected(e.target.value)}>
                        {queue.map((post) => (
                          <option key={post.id} value={post.id}>
                            {post.title}
                          </option>
                        ))}
                      </NativeSelect>
                    </Label>
                    <aside
                      aria-label="Posts awaiting review"
                      className="hidden gap-1 rounded-2xl border border-border bg-card p-2 md:grid">
                      {queue.map((p) => (
                        <button
                          key={p.id}
                          className="min-w-0 rounded-lg border border-transparent px-3 py-2.5 text-start hover:bg-secondary aria-pressed:border-border aria-pressed:bg-secondary focus-visible:outline-primary"
                          aria-pressed={reviewPost.id === p.id}
                          onClick={() => setSelected(p.id)}>
                          <span className="block break-words text-sm font-medium">{p.title}</span>
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {w.members.find((m) => m.userId === p.ownerId)?.user.name ?? "Unassigned"}
                          </span>
                        </button>
                      ))}
                    </aside>
                    <PostDetail key={reviewPost.id} workspace={w} post={reviewPost} run={run} edit={() => {}} queue />
                  </div>
                ) : (
                  <p className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    The review queue is clear.
                  </p>
                )}
              </section>
            ) : editing && w.member.role !== "Viewer" ? (
              <PostEditor
                key={item?.id ?? "new"}
                workspace={w}
                post={item}
                plannedDay={plannedDay}
                run={run}
                close={() => setEditing(false)}
              />
            ) : item ? (
              <>
                <Button className="mb-3" variant="ghost" size="sm" onClick={() => setSelected("")}>
                  <ArrowLeft /> Calendar
                </Button>
                <PostDetail workspace={w} post={item} run={run} edit={() => setEditing(true)} />
              </>
            ) : (
              <PlannerCalendar
                workspace={w}
                open={setSelected}
                create={w.member.role === "Viewer" ? undefined : newPost}
              />
            )}
          </fieldset>
        </TabsContent>
      </Tabs>
    </>
  );
}
export default function TeamPlanner() {
  const index = useQuery({ queryKey: ["team-workspaces"], queryFn: () => request<WorkspaceIndex>(base) });
  const [active, setActive] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const data = index.data;
  const id = data?.workspaces.find((w) => w.id === active)?.id ?? data?.workspaces[0]?.id;
  async function submit(payload: unknown) {
    setBusy(true);
    setError("");
    try {
      const item = await request<{ id: string }>(base, json(payload));
      await index.refetch({ throwOnError: true });
      setActive(item.id);
      setCreating(false);
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const current = data?.workspaces.find((w) => w.id === id);
  const canCreate = !!data && data.owned < data.limit;
  const switcher = data && current && (
    <h1 className="min-w-0 max-w-full text-xl font-semibold tracking-[-0.025em] text-foreground">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex max-w-full items-center gap-2 rounded-md text-start hover:text-primary focus-visible:outline-primary"
          title="Switch workspace">
          <span className="truncate">{current.name}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {data.workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => setActive(w.id)}>
              <span>{w.icon}</span>
              {w.name}
              {w.id === current.id && <Check className="ms-auto size-4" />}
            </DropdownMenuItem>
          ))}
          {canCreate && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setCreating(true)}>
                <Plus />
                Create workspace
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </h1>
  );
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="mx-auto max-w-6xl px-[clamp(18px,4vw,48px)] py-6">
        {(error || index.error) && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error || index.error?.message}{" "}
            <button className="underline" onClick={() => void index.refetch()}>
              Retry
            </button>
          </p>
        )}
        {data?.invites.map((i) => (
          <div
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-4 text-sm"
            key={i.id}>
            <span>Invitation to {i.workspace.name}</span>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void submit({ action: "accept", workspaceId: i.workspaceId, inviteId: i.id })}>
              Accept invitation
            </Button>
          </div>
        ))}
        {creating ? (
          <form
            className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-border bg-card p-4 sm:p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void submit(Object.fromEntries(d));
            }}>
            <h1 className="text-xl font-semibold tracking-tight">Create workspace</h1>
            <Label className="flex-col items-stretch">
              Name
              <Input name="name" maxLength={80} required autoFocus />
            </Label>
            <Label className="flex-col items-stretch">
              Icon
              <Input name="icon" defaultValue="◉" maxLength={12} required />
            </Label>
            <Label className="flex-col items-stretch">
              Description
              <Textarea name="description" maxLength={500} />
            </Label>
            <div className="flex gap-2">
              <Button disabled={busy}>Create</Button>
              <Button variant="outline" type="button" onClick={() => setCreating(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : id ? (
          <Team switcher={switcher} key={id} id={id} refreshIndex={() => void index.refetch()} />
        ) : data ? (
          <>
            <h1 className="text-xl font-semibold tracking-tight">Team workspaces</h1>
            <p className="my-3 text-sm text-muted-foreground">
              {data.limit
                ? "Create your first workspace to start planning."
                : "Join a workspace by invitation, or create one on Advanced or Pro."}
            </p>
            {canCreate && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                Create workspace
              </Button>
            )}
          </>
        ) : (
          <p>Loading workspaces…</p>
        )}
      </main>
    </div>
  );
}
