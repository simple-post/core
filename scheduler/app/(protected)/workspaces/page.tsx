"use client";
import { useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ClipboardCheck, Settings2, Plus, ArrowLeft } from "lucide-react";

import { Navbar } from "@/components/navbar";
import { PlannerCalendar } from "@/components/workspaces/calendar";
import { PostDetail } from "@/components/workspaces/detail";
import { PostEditor } from "@/components/workspaces/editor";
import { TeamSettings } from "@/components/workspaces/settings";
import { json, request, type Workspace, type WorkspaceIndex, type Run } from "@/components/workspaces/types";
import "./planner.css";

const base = "/api/v1/workspaces";
function Team({ id, refreshIndex }: { id: string; refreshIndex: () => void }) {
  const query = useQuery({
    queryKey: ["team-planner", id],
    refetchOnWindowFocus: true,
    staleTime: 0,
    queryFn: () => request<Workspace>(base + "/" + id),
  });
  const [requestedTab, setTab] = useState("Calendar");
  const [selected, setSelected] = useState("");
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
      <p role="alert">
        {query.error.message} <button onClick={() => void query.refetch()}>Retry</button>
      </p>
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
  return (
    <>
      <header className="tw-heading">
        <div>
          <h1>{w.name}</h1>
          {w.description && <p>{w.description}</p>}
        </div>
        {w.member.role !== "Viewer" && (
          <button
            className="primary"
            onClick={() => {
              setSelected("");
              setEditing(true);
              setTab("Calendar");
            }}>
            <Plus size={16} />
            New post
          </button>
        )}
      </header>
      <nav className="tw-tabs" aria-label="Workspace views">
        {tabs.map((t) => (
          <button
            key={t.name}
            aria-current={tab === t.name ? "page" : undefined}
            onClick={() => {
              setTab(t.name);
              setSelected("");
              setEditing(false);
              setError("");
            }}>
            <t.icon size={16} />
            {t.name}
            {t.name === "Approvals" && <span>{queue.length}</span>}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() => {
              void query.refetch();
              setEditing(false);
              setError("");
            }}>
            Reload workspace
          </button>
        </p>
      )}
      <fieldset disabled={busy} className="tw-body" aria-busy={busy}>
        {tab === "Settings" ? (
          <TeamSettings workspace={w} run={run} />
        ) : tab === "Approvals" ? (
          <section>
            <div className="tw-toolbar">
              <h2>Approval feed</h2>
              <span>{queue.length} awaiting review</span>
            </div>
            {queue[0] ? (
              <div className="tw-feed">
                <aside>
                  {queue.map((p, i) => (
                    <button
                      key={p.id}
                      aria-pressed={(queue.find((x) => x.id === selected) ?? queue[0]).id === p.id}
                      onClick={() => setSelected(p.id)}>
                      <small>Review {i + 1}</small>
                      <b>{p.title}</b>
                    </button>
                  ))}
                </aside>
                <PostDetail
                  key={(queue.find((x) => x.id === selected) ?? queue[0]).id}
                  workspace={w}
                  post={queue.find((x) => x.id === selected) ?? queue[0]}
                  run={run}
                  edit={() => {}}
                  queue
                />
              </div>
            ) : (
              <p className="tw-empty">The review queue is clear.</p>
            )}
          </section>
        ) : editing && w.member.role !== "Viewer" ? (
          <PostEditor key={item?.id ?? "new"} workspace={w} post={item} run={run} close={() => setEditing(false)} />
        ) : item ? (
          <>
            <button className="tw-back" onClick={() => setSelected("")}>
              <ArrowLeft size={15} /> Calendar
            </button>
            <PostDetail workspace={w} post={item} run={run} edit={() => setEditing(true)} />
          </>
        ) : (
          <PlannerCalendar workspace={w} open={(p) => setSelected(p.id)} />
        )}
      </fieldset>
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
  return (
    <>
      <Navbar />
      <main className="tw">
        <div className="tw-switch">
          <label>
            Workspace
            {data?.workspaces.length ? (
              <select
                aria-label="Workspace selector"
                value={id}
                onChange={(e) => {
                  setActive(e.target.value);
                  setCreating(false);
                }}>
                {data.workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.icon} {w.name}
                  </option>
                ))}
              </select>
            ) : null}
          </label>
          {data && data.owned < data.limit && <button onClick={() => setCreating(true)}>Create workspace</button>}
        </div>
        {(error || index.error) && (
          <p role="alert">
            {error || index.error?.message} <button onClick={() => void index.refetch()}>Retry</button>
          </p>
        )}
        {data?.invites.map((i) => (
          <div className="tw-row" key={i.id}>
            <span>Invitation to {i.workspace.name}</span>
            <button
              disabled={busy}
              onClick={() => void submit({ action: "accept", workspaceId: i.workspaceId, inviteId: i.id })}>
              Accept invitation
            </button>
          </div>
        ))}
        {creating ? (
          <form
            className="tw-editor"
            onSubmit={(e) => {
              e.preventDefault();
              const d = new FormData(e.currentTarget);
              void submit(Object.fromEntries(d));
            }}>
            <h1>Create workspace</h1>
            <label>
              Name
              <input name="name" maxLength={80} required autoFocus />
            </label>
            <label>
              Icon
              <input name="icon" defaultValue="◉" maxLength={12} required />
            </label>
            <label>
              Description
              <textarea name="description" maxLength={500} />
            </label>
            <div className="tw-line">
              <button className="primary" disabled={busy}>
                Create
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : id ? (
          <Team key={id} id={id} refreshIndex={() => void index.refetch()} />
        ) : data ? (
          <>
            <h1>Team workspaces</h1>
            <p>
              {data.limit
                ? "Create your first workspace to start planning."
                : "Join a workspace by invitation, or create one on Advanced or Pro."}
            </p>
          </>
        ) : (
          <p>Loading workspaces…</p>
        )}
      </main>
    </>
  );
}
