import { useCallback, useEffect, useRef, useState } from "react";

import {
  CheckCircle2,
  Clock3,
  FileText,
  AlertCircle,
  Plus,
  RefreshCw,
  Settings2,
  ExternalLink,
  CircleHelp,
  ImageIcon,
} from "lucide-react";

import { AccountIdentity } from "./account-identity";
import { Calendar, PlatformBadge } from "./calendar";
import { Editor } from "./editor";
import { askChat, attachSelection, callTool, restoreEditorHint, useExtensionHost } from "./host";
import { localDateTime } from "./timezone";

import type { ScheduleEntry } from "../schedule";
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
  const guessedZone = useRef(false);
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
      timeZone: launch.schedule.timeZone,
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
  useEffect(() => {
    if (!app || !launch || launch.preferences.timeZoneConfirmed || guessedZone.current) return;
    guessedZone.current = true;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    void act(async () => {
      if (launch.canWrite) await callTool(app, "update_simplepost_settings", { set: { timeZone } });
      const next = await callTool<WorkspaceData>(app, "get_simplepost_workspace", {
        view: launch.schedule.view,
        date: launch.schedule.anchorDate,
        timeZone,
        status: launch.posts.status === "all" || launch.posts.status === "single" ? "drafts" : launch.posts.status,
      });
      setLaunch(next);
    });
  }, [app, launch, setLaunch, act]);
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
          {editorOnly || editor ? null : (
            <nav className="sp-top-nav" aria-label="Workspace sections">
              <button
                aria-pressed={tab !== "accounts"}
                onClick={() =>
                  setTab(
                    ["drafts", "scheduled", "posted", "failed"].includes(launch.posts.status)
                      ? launch.posts.status
                      : "calendar",
                  )
                }>
                Posts
              </button>
              <button aria-pressed={tab === "accounts"} onClick={() => setTab("accounts")}>
                Accounts
              </button>
            </nav>
          )}
        </div>
        {editor ? null : (
          <div className="sp-actions">
            <button
              className="sp-icon-button"
              aria-label="Refresh"
              disabled={busy}
              onClick={() => void act(() => refresh())}>
              <RefreshCw size={16} />
            </button>
            <button
              className="sp-icon-button"
              aria-label="Preferences"
              onClick={() => {
                setZone(
                  launch.preferences.timeZoneConfirmed
                    ? launch.preferences.timeZone
                    : Intl.DateTimeFormat().resolvedOptions().timeZone,
                );
                setSettings(!settings);
              }}>
              <Settings2 size={16} />
            </button>
            <button className="sp-primary" disabled={!canCompose || busy} onClick={() => void act(() => openEditor())}>
              <Plus size={16} /> New draft
            </button>
          </div>
        )}
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
              {tab === "accounts" ? null : (
                <>
                  <div className="sp-page-heading">
                    <span>DASHBOARD</span>
                    <h1>Your posts</h1>
                  </div>
                  <Calendar
                    data={launch.schedule}
                    busy={busy}
                    selectedId={selected?.id}
                    onSelect={select}
                    onNavigate={(input) => void act(() => refresh(input))}
                    onSettings={() =>
                      void app?.openLink({ url: `${launch.accountsUrl.split("/accounts")[0]}/settings` })
                    }
                  />
                  <nav className="sp-nav" aria-label="Post status">
                    {[
                      { name: "drafts", label: "Drafts", icon: FileText },
                      { name: "scheduled", label: "Scheduled", icon: Clock3 },
                      { name: "posted", label: "Published", icon: CheckCircle2 },
                      { name: "failed", label: "Failed", icon: AlertCircle },
                    ].map(({ name, label, icon: Icon }) => (
                      <button
                        key={name}
                        disabled={busy}
                        aria-pressed={(tab === "calendar" ? "drafts" : tab) === name}
                        onClick={() => {
                          setTab(name);
                          void act(() => refresh({ status: name, page: 1 }));
                        }}>
                        <Icon size={15} />
                        {label}
                      </button>
                    ))}
                  </nav>
                </>
              )}
              {tab === "accounts" ? (
                <section className="sp-accounts">
                  <header className="sp-account-heading">
                    <div className="sp-inline-heading">
                      <span className="sp-kicker">Accounts</span>
                      <h1>
                        Connected <em>accounts</em>
                      </h1>
                    </div>
                    <button className="sp-primary" onClick={() => void app?.openLink({ url: launch.accountsUrl })}>
                      <Plus size={16} />
                      Connect account
                    </button>
                  </header>
                  <button
                    className="sp-help-link"
                    onClick={() => void app?.openLink({ url: "https://docs.simplepost.social/accounts" })}>
                    <CircleHelp size={13} />
                    Connection and account requirements
                  </button>
                  {launch.accounts.map((account) => (
                    <article key={account.accountId} className="sp-account-card">
                      <div className="sp-account-main">
                        <AccountIdentity account={account} />
                        {account.credentialStatus.severity && account.credentialStatus.severity !== "ok" ? (
                          <div className={`sp-account-health ${account.credentialStatus.severity}`}>
                            <span>{account.credentialStatus.label}</span>
                            <p>{account.credentialStatus.message}</p>
                          </div>
                        ) : null}
                        <button
                          className="sp-help-link"
                          onClick={() =>
                            void app?.openLink({ url: `https://docs.simplepost.social/accounts#${account.platform}` })
                          }>
                          <CircleHelp size={12} />
                          Connection help
                        </button>
                        {account.trialAllowance ? (
                          <small>{account.trialAllowance.remaining} trial posts remaining</small>
                        ) : null}
                      </div>
                      <button
                        aria-label={`Manage ${account.displayName ?? account.username ?? account.platform}`}
                        onClick={() => void app?.openLink({ url: launch.accountsUrl.split("?")[0] })}>
                        <ExternalLink size={14} />
                        Manage account
                      </button>
                    </article>
                  ))}
                </section>
              ) : null}
            </>
          )}
          {tab !== "accounts" || editorOnly ? (
            <section className="sp-post-list" aria-label="Saved posts">
              <h2 className="sp-sr-only">
                {editorOnly || tab === "calendar"
                  ? "Drafts and working copies"
                  : tab === "posted"
                    ? "Published posts"
                    : `${tab.charAt(0).toUpperCase() + tab.slice(1)} posts`}
              </h2>
              {launch.posts.posts.length === 0 ? (
                <div className="sp-empty-posts">
                  <FileText size={24} />
                  <p>No posts here yet. Start a new draft when you’re ready.</p>
                </div>
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
                      <span className="sp-post-thumbnail">
                        {post.media?.[0] && (post.media[0].type === "image" || post.media[0].thumbnailUrl) ? (
                          <img src={post.media[0].thumbnailUrl || post.media[0].url} alt="" />
                        ) : (
                          <ImageIcon size={32} />
                        )}
                        <span className="sp-post-platforms">
                          {[...new Set(post.accounts.map((a) => a.platform))].map((platform) => (
                            <PlatformBadge key={platform} platform={platform} />
                          ))}
                        </span>
                      </span>
                      <span className="sp-post-copy">
                        <strong>{post.message.slice(0, 160) || "Untitled draft"}</strong>
                        <small>
                          <Clock3 size={12} />
                          {post.scheduledFor
                            ? localDateTime(new Date(post.scheduledFor), launch.schedule.timeZone).replace("T", " ")
                            : post.createdAt
                              ? `Saved ${new Date(post.createdAt).toLocaleDateString()}`
                              : "Draft"}
                        </small>
                        <span className="sp-post-handles">
                          {post.accounts
                            .slice(0, 2)
                            .map((a) =>
                              a.username ? `@${a.username.replace(/^@/, "")}` : (a.displayName ?? a.platform),
                            )
                            .join(" · ")}
                          {post.accounts.length > 2 ? ` +${post.accounts.length - 2}` : ""}
                        </span>
                      </span>
                    </label>
                    <span className={`sp-post-status status-${post.status}`}>
                      <FileText size={12} />
                      {post.status}
                    </span>
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
