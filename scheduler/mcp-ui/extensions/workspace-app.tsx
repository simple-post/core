import { useCallback, useEffect, useRef, useState } from "react";

import { DayAgenda, WeekView, MonthView, Summary, type ScheduleEntry } from "../schedule";

import { Editor } from "./editor";
import { askChat, attachSelection, callTool, restoreEditorHint, useExtensionHost } from "./host";
import { localDateTime } from "./timezone";

import type { EditorData, WorkspaceData } from "./types";
import "./workspace.css";

export function Workspace({ editorOnly = false }: { editorOnly?: boolean }) {
  const { app, launch, setLaunch, incoming, error } = useExtensionHost<WorkspaceData>();
  const [editor, setEditor] = useState<EditorData | null>(null);
  const [selected, setSelected] = useState<ScheduleEntry | null>(null);
  const [chosenPosts, setChosenPosts] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("calendar");
  const [settings, setSettings] = useState(false);
  const [zone, setZone] = useState("");
  const restored = useRef(false);
  const requested = useRef<string | null>(null);
  const [slotTime, setSlotTime] = useState<string | null>(null);

  const act = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error_) {
      setNotice(error_ instanceof Error ? error_.message : String(error_));
    } finally {
      setBusy(false);
    }
  }, []);
  async function refresh(overrides: Record<string, unknown> = {}) {
    if (!app || !launch) return;
    const data = await callTool<WorkspaceData>(app, "get_simplepost_workspace", {
      view: launch.schedule.view,
      date: launch.schedule.anchorDate,
      status: launch.posts.status === "single" || launch.posts.status === "all" ? "drafts" : launch.posts.status,
      ...overrides,
    });
    setLaunch(data);
  }
  const openEditor = useCallback(
    async (postId?: string) => {
      if (!app || !launch?.canWrite) return;
      setEditor(await callTool<EditorData>(app, "start_post_editor_session", postId ? { postId } : {}));
    },
    [app, launch?.canWrite],
  );
  useEffect(() => {
    if (!app || !launch || restored.current) return;
    restored.current = true;
    const sessionId = restoreEditorHint()?.sessionId;
    if (sessionId && !launch.requestedPostId)
      void act(async () => {
        setEditor(await callTool<EditorData>(app, "read_post_editor_session", { sessionId }));
      });
  }, [app, launch, act, openEditor]);
  useEffect(() => {
    if (!app || !launch?.requestedPostId || requested.current === launch.requestedPostId) return;
    requested.current = launch.requestedPostId;
    void act(() => openEditor(launch.requestedPostId!));
  }, [app, launch, act, openEditor]);
  useEffect(() => {
    if (!app) return;
    const onContext = (context: Record<string, unknown>) => {
      if (context["openai/modelContext"] === null) {
        setSelected(null);
        setChosenPosts([]);
      }
    };
    app.addEventListener("hostcontextchanged", onContext);
    return () => app.removeEventListener("hostcontextchanged", onContext);
  }, [app]);
  if (!launch)
    return (
      <main className="sp-workspace">
        <p role="status">{error?.message ?? "Opening your publishing workspace…"}</p>
      </main>
    );

  const selection = {
    selectedSlot:
      selected?.kind === "slot"
        ? { at: selected.at, timeZone: launch!.schedule.timeZone, localTime: selected.localTime }
        : null,
    postIds: chosenPosts,
    selectedPostId: selected?.postId ?? null,
  };
  function select(entry: ScheduleEntry) {
    setSelected(entry);
    if (app)
      void act(async () => {
        await attachSelection(app, {
          ...selection,
          selectedPostId: entry.postId,
          selectedSlot: entry.kind === "slot" ? { at: entry.at, timeZone: launch!.schedule.timeZone } : null,
        });
      });
  }
  const canCompose = launch.canWrite && launch.accounts.length > 0;
  return (
    <main className="sp-workspace">
      <header className="sp-header">
        <div>
          <span className="sp-mark">SP</span>
          <strong>SimplePost</strong>
          <span className="sp-subtitle">{editorOnly ? "Post editor" : "Publishing workspace"}</span>
        </div>
        <div className="sp-actions">
          <button disabled={busy} onClick={() => void act(() => refresh())}>
            Refresh
          </button>
          <button
            onClick={() => {
              setZone(
                launch.preferences.timeZoneConfirmed
                  ? launch.preferences.timeZone
                  : Intl.DateTimeFormat().resolvedOptions().timeZone,
              );
              setSettings(!settings);
            }}>
            Preferences
          </button>
          <button className="sp-primary" disabled={!canCompose || busy} onClick={() => void act(() => openEditor())}>
            New draft
          </button>
        </div>
      </header>
      {notice ? (
        <div role="alert" className="sp-notice">
          {notice}
        </div>
      ) : null}
      {launch.accounts.length === 0 ? (
        <section className="sp-onboarding">
          <h1>Connect your first destination</h1>
          <p>
            Choose at least one social platform in SimplePost, then return here to write and preview your first draft.
          </p>
          <button className="sp-primary" onClick={() => void app?.openLink({ url: launch.accountsUrl })}>
            Connect a platform
          </button>
          <button disabled={busy} onClick={() => void act(() => refresh())}>
            I’ve connected a platform — refresh
          </button>
        </section>
      ) : null}
      {launch.accounts.length > 0 && !launch.preferences.timeZoneConfirmed ? (
        <section className="sp-banner">
          <span>Confirm your timezone before choosing publishing times. The calendar currently shows UTC.</span>
          <button
            onClick={() => {
              setSettings(true);
              setZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
            }}>
            Set timezone
          </button>
        </section>
      ) : null}
      {settings ? (
        <section className="sp-settings" aria-label="Publishing preferences">
          <h2>Publishing preferences</h2>
          <label>
            Timezone
            <input
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              placeholder="Europe/Berlin"
              list="sp-timezones"
            />
          </label>
          <datalist id="sp-timezones">
            {[
              "UTC",
              "Europe/Berlin",
              "Europe/London",
              "America/New_York",
              "America/Los_Angeles",
              "Asia/Tokyo",
              "Australia/Sydney",
            ].map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <p>Existing scheduled posts keep their exact publishing time. New selections use this timezone.</p>
          <label>
            Default calendar view
            <select
              disabled={busy || !launch.canWrite}
              value={launch.preferences.calendarView}
              onChange={(event) =>
                void act(async () => {
                  if (app) {
                    await callTool(app, "update_simplepost_settings", { set: { calendarView: event.target.value } });
                    await refresh({ view: event.target.value });
                  }
                })
              }>
              {["day", "week", "month"].map((view) => (
                <option key={view}>{view}</option>
              ))}
            </select>
          </label>
          <fieldset disabled={busy || !launch.canWrite}>
            <legend>Default destinations for new drafts</legend>
            {launch.accounts.map((account) => (
              <label key={account.accountId}>
                <input
                  type="checkbox"
                  checked={launch.preferences.defaultAccountIds.includes(account.accountId)}
                  onChange={(event) =>
                    void act(async () => {
                      if (app) {
                        const ids = event.target.checked
                          ? [...launch.preferences.defaultAccountIds, account.accountId]
                          : launch.preferences.defaultAccountIds.filter((id) => id !== account.accountId);
                        await callTool(app, "update_simplepost_settings", { set: { defaultAccountIds: ids } });
                        await refresh();
                      }
                    })
                  }
                />
                {account.displayName ?? account.username ?? account.platform} · {account.platform}
              </label>
            ))}
          </fieldset>
          <button
            disabled={busy || !launch.canWrite}
            className="sp-primary"
            onClick={() =>
              void act(async () => {
                if (app) {
                  await callTool(app, "update_simplepost_settings", { set: { timeZone: zone } });
                  await refresh({ timeZone: zone });
                  setSettings(false);
                }
              })
            }>
            Save timezone
          </button>
        </section>
      ) : null}
      {editor && app ? (
        <Editor
          key={editor.sessionId}
          initial={editor}
          app={app}
          accounts={launch.accounts}
          timeZone={launch.schedule.timeZone}
          timeZoneConfirmed={launch.preferences.timeZoneConfirmed}
          proposedTime={slotTime}
          incoming={incoming}
          canValidate={launch.canValidate}
          canWrite={launch.canWrite}
          imageFittingEnabled={launch.imageFittingEnabled}
          onClose={() => {
            setEditor(null);
            setSlotTime(null);
          }}
          onCommitted={(next) => {
            setEditor(next);
            void act(() => refresh());
          }}
        />
      ) : (
        <>
          {editorOnly ? (
            <h1>Choose a draft to edit</h1>
          ) : (
            <>
              <nav className="sp-nav" aria-label="Workspace sections">
                {["calendar", "drafts", "scheduled", "posted", "failed", "accounts"].map((name) => (
                  <button
                    key={name}
                    aria-pressed={tab === name}
                    onClick={() => {
                      setTab(name);
                      if (name !== "accounts")
                        void act(() => refresh({ status: name === "calendar" ? "drafts" : name, page: 1 }));
                    }}>
                    {name === "posted" ? "Published" : name.charAt(0).toUpperCase() + name.slice(1)}
                  </button>
                ))}
              </nav>
              {tab === "calendar" ? (
                <section className="sp-calendar">
                  <div className="sp-calendar-toolbar">
                    <h1>{launch.schedule.periodLabel}</h1>
                    <button
                      onClick={() =>
                        void app?.openLink({ url: `${launch.accountsUrl.split("/accounts")[0]}/settings` })
                      }>
                      Manage recurring slots
                    </button>
                    <div className="sp-actions">
                      <button
                        aria-label="Previous period"
                        disabled={busy}
                        onClick={() => void act(() => refresh({ date: launch.schedule.previousAnchorDate }))}>
                        ←
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void act(() => refresh({ date: launch.schedule.todayAnchorDate }))}>
                        Today
                      </button>
                      <button
                        aria-label="Next period"
                        disabled={busy}
                        onClick={() => void act(() => refresh({ date: launch.schedule.nextAnchorDate }))}>
                        →
                      </button>
                      {["day", "week", "month"].map((view) => (
                        <button
                          key={view}
                          aria-pressed={launch.schedule.view === view}
                          disabled={busy}
                          onClick={() => void act(() => refresh({ view }))}>
                          {view}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="sp-calendar-summary">
                    <Summary data={launch.schedule} />
                    <span>{launch.schedule.timeZone}</span>
                  </div>
                  {launch.schedule.view === "day" ? (
                    <DayAgenda
                      day={
                        launch.schedule.days.find((day) => day.date === launch.schedule.anchorDate) ??
                        launch.schedule.days[0]
                      }
                      onSelect={select}
                    />
                  ) : launch.schedule.view === "week" ? (
                    <WeekView days={launch.schedule.days} onSelect={select} />
                  ) : (
                    <MonthView days={launch.schedule.days} onSelect={select} />
                  )}
                </section>
              ) : null}
              {tab === "accounts" ? (
                <section className="sp-accounts">
                  <h1>Connected destinations</h1>
                  {launch.accounts.map((account) => (
                    <article key={account.accountId}>
                      <strong>{account.displayName ?? account.username ?? account.platform}</strong>
                      <span>{account.platform}</span>
                      <p>{account.credentialStatus.message}</p>
                      {account.trialAllowance ? (
                        <small>{account.trialAllowance.remaining} trial posts remaining</small>
                      ) : null}
                    </article>
                  ))}
                  <button onClick={() => void app?.openLink({ url: launch.accountsUrl })}>Manage destinations</button>
                </section>
              ) : null}
            </>
          )}
          {tab !== "accounts" || editorOnly ? (
            <section className="sp-post-list" aria-label="Saved posts">
              <h2>
                {editorOnly || tab === "calendar"
                  ? "Drafts and working copies"
                  : tab === "posted"
                    ? "Published posts"
                    : `${tab.charAt(0).toUpperCase() + tab.slice(1)} posts`}
              </h2>
              {launch.posts.posts.length === 0 ? (
                <p>No posts here yet. Start a new draft when you’re ready.</p>
              ) : (
                launch.posts.posts.map((post) => (
                  <article key={post.id}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Select ${post.message.slice(0, 60) || "untitled post"}`}
                        checked={chosenPosts.includes(post.id)}
                        onChange={(event) => {
                          const ids = event.target.checked
                            ? [...chosenPosts, post.id].slice(0, 20)
                            : chosenPosts.filter((id) => id !== post.id);
                          setChosenPosts(ids);
                          if (app)
                            void act(async () => {
                              await attachSelection(app, { ...selection, postIds: ids });
                            });
                        }}
                      />
                      <span>
                        <strong>{post.message.slice(0, 160) || "Untitled draft"}</strong>
                        <small>
                          {post.status} · {post.accounts.map((a) => a.platform).join(", ")}
                          {post.scheduledFor
                            ? ` · ${localDateTime(new Date(post.scheduledFor), launch.schedule.timeZone).replace("T", " ")}`
                            : ""}
                        </small>
                      </span>
                    </label>
                    <button
                      disabled={busy || ((post.status === "draft" || post.status === "scheduled") && !canCompose)}
                      onClick={() =>
                        void act(async () => {
                          await (post.status === "draft" || post.status === "scheduled"
                            ? openEditor(post.id)
                            : app?.openLink({ url: `${launch.accountsUrl.split("/accounts")[0]}/posts/${post.id}` }));
                        })
                      }>
                      {post.status === "draft" || post.status === "scheduled" ? "Edit" : "View results"}
                    </button>
                  </article>
                ))
              )}
              {launch.posts.pagination ? (
                <div className="sp-actions">
                  <button
                    disabled={busy || !launch.posts.pagination.hasPreviousPage}
                    onClick={() => void act(() => refresh({ page: launch.posts.pagination!.page - 1 }))}>
                    Previous page
                  </button>
                  <span>
                    Page {launch.posts.pagination.page} of {launch.posts.pagination.totalPages || 1}
                  </span>
                  <button
                    disabled={busy || !launch.posts.pagination.hasNextPage}
                    onClick={() => void act(() => refresh({ page: launch.posts.pagination!.page + 1 }))}>
                    Next page
                  </button>
                </div>
              ) : null}
              {launch.recovery.length > 0 ? (
                <details>
                  <summary>Recover a working copy</summary>
                  {launch.recovery.map((session) => (
                    <button
                      key={session.id}
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          if (app)
                            setEditor(
                              await callTool<EditorData>(app, "read_post_editor_session", { sessionId: session.id }),
                            );
                        })
                      }>
                      {session.message || "Untitled working copy"} · {new Date(session.updatedAt).toLocaleString()}
                    </button>
                  ))}
                </details>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {(selected || chosenPosts.length > 0) && !editor ? (
        <aside className="sp-selection">
          <strong>
            {selected?.kind === "slot"
              ? `Selected slot: ${selected.localTime} · ${launch.schedule.timeZone}`
              : `${chosenPosts.length || 1} post(s) selected`}
          </strong>
          <div className="sp-actions">
            {selected?.postId ? (
              <button disabled={!canCompose || busy} onClick={() => void act(() => openEditor(selected.postId!))}>
                Edit selected post
              </button>
            ) : null}
            {selected?.kind === "slot" && !selected.isPast ? (
              <button
                className="sp-primary"
                disabled={!canCompose || busy}
                onClick={() =>
                  void act(async () => {
                    setSlotTime(selected.at);
                    await openEditor();
                  })
                }>
                Draft for this slot
              </button>
            ) : null}
            <button
              disabled={!app || busy}
              onClick={() =>
                void act(async () => {
                  if (app)
                    await askChat(
                      app,
                      selected?.kind === "slot"
                        ? "Help me prepare a post for this selected slot. Propose content; do not schedule it yet."
                        : "Help me plan these selected posts into available slots. Show the proposed times before scheduling.",
                      selection,
                    );
                })
              }>
              Ask ChatGPT
            </button>
            <button
              onClick={() => {
                setSelected(null);
                setChosenPosts([]);
                if (app)
                  void act(async () => {
                    await attachSelection(app, null);
                  });
              }}>
              Clear selection
            </button>
          </div>
        </aside>
      ) : null}
    </main>
  );
}
