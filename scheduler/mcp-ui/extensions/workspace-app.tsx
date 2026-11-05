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
  ArrowLeft,
} from "lucide-react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Tabs } from "../../components/ui/tabs";
import { AccountAvatarView } from "../../components/visual/account-avatar";
import { AccountCardView, AccountsHeading, ConnectAccountsEmpty } from "../../components/visual/account-card";
import { SimplePostBrand, WorkspaceNavigation } from "../../components/visual/navigation";
import { getAccountDisplayName, getPlatformName } from "../../components/visual/platforms";
import { PostCardView } from "../../components/visual/post-card";
import { PostStatusTabs } from "../../components/visual/post-status-tabs";

import { UiLocaleProvider } from "../../lib/i18n/client";
import { Calendar } from "./calendar";
import { Editor } from "./editor";
import { askChat, attachSelection, callTool, isWorkspaceLaunch, restoreEditorHint, useExtensionHost } from "./host";

import type { ScheduleEntry } from "../schedule";
import type { EditorData, WorkspaceData } from "./types";
import "./design-system.css";
import "./workspace.css";

export function Workspace({ editorOnly = false }: { editorOnly?: boolean }) {
  const [workspaceOpened, setWorkspaceOpened] = useState(false);
  const chooserOnly = editorOnly && !workspaceOpened;
  const { app, launch, setLaunch, incoming, error, toolError, setToolError, locale, messages, t } =
    useExtensionHost<WorkspaceData>();
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
  const launchError = error?.message ?? toolError;

  const loadLaunch = useCallback(async () => {
    if (!app) return;
    setBusy(true);
    setToolError(null);
    try {
      const data = await callTool<WorkspaceData>(app, "get_simplepost_workspace");
      if (!isWorkspaceLaunch(data)) throw new Error("The publishing workspace returned incomplete data.");
      setLaunch((current) => current ?? data);
    } catch (error_) {
      setToolError(error_ instanceof Error ? error_.message : String(error_));
    } finally {
      setBusy(false);
    }
  }, [app, setLaunch, setToolError]);

  useEffect(() => {
    if (!app || launch || launchError || busy) return;
    // Prefer the opening result. Recover once only if the connected host never
    // delivers it; explicit failures need a user retry rather than a retry loop.
    const timeout = window.setTimeout(() => void loadLaunch(), 5000);
    return () => window.clearTimeout(timeout);
  }, [app, launch, launchError, busy, loadLaunch]);

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
        {launchError ? (
          <div role="alert" className="sp-notice">
            <p>{launchError}</p>
            {app ? (
              <Button variant="outline" disabled={busy} onClick={() => void loadLaunch()}>
                {locale === "en" ? "Retry" : t("retry")}
              </Button>
            ) : (
              <p>{t("workspaceReconnect")}</p>
            )}
          </div>
        ) : (
          <p role="status">{t("openWorkspace")}</p>
        )}
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
  const content = (
    <main className="sp-workspace">
      <header className="sp-header">
        <div>
          <SimplePostBrand logoSrc={`${launch.accountsUrl.split("/accounts")[0]}/simplepost-logo.png`} />
          {chooserOnly || editor ? null : (
            <WorkspaceNavigation
              active={tab === "accounts" ? "accounts" : "posts"}
              renderItem={({ id, label, className, children }) => (
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={id === "accounts" ? tab === "accounts" : tab !== "accounts"}
                  className={className}
                  onClick={() =>
                    setTab(
                      id === "accounts"
                        ? "accounts"
                        : ["drafts", "scheduled", "posted", "failed"].includes(launch.posts.status)
                          ? launch.posts.status
                          : "calendar",
                    )
                  }>
                  {children}
                </button>
              )}
            />
          )}
        </div>
        {editor ? null : (
          <div className="sp-actions">
            <Button
              variant="outline"
              size="sm"
              className="sp-icon-button"
              aria-label={t("refresh")}
              disabled={busy}
              onClick={() => void act(() => refresh())}>
              <RefreshCw size={16} />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="sp-icon-button"
              aria-label={t("preferences")}
              onClick={() => {
                setZone(
                  launch.preferences.timeZoneConfirmed
                    ? launch.preferences.timeZone
                    : Intl.DateTimeFormat().resolvedOptions().timeZone,
                );
                setSettings(!settings);
              }}>
              <Settings2 size={16} />
            </Button>
            <Button className="sp-primary" disabled={!canCompose || busy} onClick={() => void act(() => openEditor())}>
              <Plus size={16} /> {t("newDraft")}
            </Button>
          </div>
        )}
      </header>
      {notice ? (
        <div role="alert" className="sp-notice">
          {notice}
        </div>
      ) : null}
      {launch.accounts.length === 0 ? (
        <ConnectAccountsEmpty
          title={t("connectFirst")}
          description={t("connectFirstDetails")}
          action={
            <>
              <Button onClick={() => void app?.openLink({ url: launch.accountsUrl })}>{t("connectPlatform")}</Button>
              <Button variant="outline" disabled={busy} onClick={() => void act(() => refresh())}>
                {t("refreshAfterConnect")}
              </Button>
            </>
          }
        />
      ) : null}
      {settings ? (
        <section className="sp-settings" aria-label={t("publishingPreferences")}>
          <h2>{t("publishingPreferences")}</h2>
          <label>
            {t("timezone")}
            <Input
              dir="ltr"
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
          <p>{t("timezoneEffect")}</p>
          <label>
            {t("defaultCalendarView")}
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
              {(["day", "week", "month"] as const).map((view) => (
                <option key={view} value={view}>
                  {t(view)}
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={busy || !launch.canWrite}>
            <legend>{t("defaultDestinations")}</legend>
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
                <bdi>{account.displayName ?? account.username ?? account.platform}</bdi> ·{" "}
                {getPlatformName(account.platform)}
              </label>
            ))}
          </fieldset>
          <Button
            variant="outline"
            size="sm"
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
            {t("saveTimezone")}
          </Button>
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
            setWorkspaceOpened(true);
          }}
          onCommitted={(next) => {
            setEditor(next);
            void act(() => refresh());
          }}
        />
      ) : (
        <>
          {chooserOnly ? (
            <div className="sp-page-heading">
              <Button variant="outline" size="sm" onClick={() => setWorkspaceOpened(true)}>
                <ArrowLeft size={14} /> {t("backWorkspace")}
              </Button>
              <h1>{t("chooseDraft")}</h1>
            </div>
          ) : (
            <>
              {tab === "accounts" ? null : (
                <>
                  <div className="sp-page-heading">
                    <span>{t("dashboard")}</span>
                    <h1>{t("yourPosts")}</h1>
                  </div>
                  <Calendar
                    data={launch.schedule}
                    onCreate={() => void act(() => openEditor())}
                    busy={busy}
                    selectedId={selected?.id}
                    onSelect={select}
                    onNavigate={(input) => void act(() => refresh(input))}
                    onSettings={() =>
                      void app?.openLink({ url: `${launch.accountsUrl.split("/accounts")[0]}/settings` })
                    }
                  />
                  <Tabs
                    className="mt-8"
                    value={tab === "calendar" ? "drafts" : tab}
                    onValueChange={(value) => {
                      setTab(value);
                      void act(() => refresh({ status: value, page: 1 }));
                    }}>
                    <PostStatusTabs
                      disabled={busy}
                      items={[
                        { name: "drafts", label: t("drafts"), icon: FileText },
                        { name: "scheduled", label: t("postScheduled"), icon: Clock3 },
                        { name: "posted", label: t("postPublished"), icon: CheckCircle2 },
                        { name: "failed", label: t("postFailed"), icon: AlertCircle },
                      ].map(({ name, label, icon: Icon }) => ({
                        id: name,
                        label,
                        icon: <Icon className="hidden h-3.5 w-3.5 sm:block" />,
                      }))}
                    />
                  </Tabs>
                </>
              )}
              {tab === "accounts" ? (
                <section className="sp-accounts">
                  <AccountsHeading
                    action={
                      <Button onClick={() => void app?.openLink({ url: launch.accountsUrl })}>
                        <Plus size={16} />
                        {t("connectAccount")}
                      </Button>
                    }
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="sp-help-link"
                    onClick={() => void app?.openLink({ url: "https://docs.simplepost.social/accounts" })}>
                    <CircleHelp size={13} />
                    {t("connectionRequirements")}
                  </Button>
                  <div className="space-y-3">
                    {launch.accounts.map((account) => (
                      <AccountCardView
                        key={account.accountId}
                        avatar={<AccountAvatarView src={account.profilePicture ?? null} platform={account.platform} />}
                        name={getAccountDisplayName({ ...account, email: null, platformAccountId: account.accountId })}
                        platform={getPlatformName(account.platform)}
                        health={
                          account.credentialStatus.severity && account.credentialStatus.severity !== "ok" ? (
                            <Badge
                              variant={account.credentialStatus.severity === "error" ? "destructive" : "secondary"}>
                              {account.credentialStatus.label}
                            </Badge>
                          ) : null
                        }
                        help={
                          <Button
                            variant="link"
                            className="h-auto p-0 mt-2 text-xs text-muted-foreground"
                            onClick={() =>
                              void app?.openLink({ url: `https://docs.simplepost.social/accounts#${account.platform}` })
                            }>
                            <CircleHelp size={12} />
                            {t("connectionHelp")}
                          </Button>
                        }
                        details={
                          <>
                            {account.credentialStatus.severity !== "ok" && (
                              <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                                {account.credentialStatus.message}
                              </p>
                            )}
                            {account.trialAllowance && (
                              <small>{t("trialPostsRemaining", { count: account.trialAllowance.remaining })}</small>
                            )}
                          </>
                        }
                        actions={
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={t("manageNamedAccount", {
                              name: account.displayName ?? account.username ?? account.platform,
                            })}
                            onClick={() => void app?.openLink({ url: launch.accountsUrl.split("?")[0] })}>
                            <ExternalLink size={14} />
                            {t("manageAccount")}
                          </Button>
                        }
                      />
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          )}
          {tab !== "accounts" || chooserOnly ? (
            <section className="sp-post-list" aria-label={t("savedPosts")}>
              <h2 className="sp-sr-only">
                {t(
                  chooserOnly || tab === "calendar" || tab === "drafts"
                    ? "draftsAndCopies"
                    : tab === "posted"
                      ? "postPublished"
                      : tab === "failed"
                        ? "postFailed"
                        : "postScheduled",
                )}
              </h2>
              {launch.posts.posts.length === 0 ? (
                <div className="sp-empty-posts">
                  <FileText size={24} />
                  <p>{t("emptyPosts")}</p>
                </div>
              ) : (
                launch.posts.posts.map((post) => (
                  <PostCardView
                    key={post.id}
                    post={{ message: post.message, status: post.status, media: post.media ?? [] }}
                    platforms={[...new Set(post.accounts.map((a) => a.platform))]}
                    dateLabel={
                      post.scheduledFor
                        ? new Date(post.scheduledFor).toLocaleString(locale, {
                            timeZone: launch.schedule.timeZone,
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : post.createdAt
                          ? t("savedDate", { date: new Date(post.createdAt).toLocaleDateString(locale) })
                          : t("postDraft")
                    }
                    accountLabels={[
                      ...post.accounts
                        .slice(0, 2)
                        .map((a) =>
                          getAccountDisplayName({ ...a, email: null, platformAccountId: a.username ?? a.platform }),
                        ),
                      ...(post.accounts.length > 2 ? [`+${post.accounts.length - 2}`] : []),
                    ]}
                    selection={
                      <input
                        type="checkbox"
                        aria-label={t("selectPost", { post: post.message.slice(0, 60) || t("untitledPost") })}
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
                    }
                    actions={
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || ((post.status === "draft" || post.status === "scheduled") && !canCompose)}
                        onClick={() =>
                          void act(async () => {
                            await (post.status === "draft" || post.status === "scheduled"
                              ? openEditor(post.id)
                              : app?.openLink({ url: `${launch.accountsUrl.split("/accounts")[0]}/posts/${post.id}` }));
                          })
                        }>
                        {post.status === "draft" || post.status === "scheduled" ? t("edit") : t("viewResults")}
                      </Button>
                    }
                  />
                ))
              )}
              {launch.posts.pagination ? (
                <div className="sp-actions">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !launch.posts.pagination.hasPreviousPage}
                    onClick={() => void act(() => refresh({ page: launch.posts.pagination!.page - 1 }))}>
                    {t("previousPage")}
                  </Button>
                  <span>
                    {t("pageCount", {
                      page: launch.posts.pagination.page,
                      pages: launch.posts.pagination.totalPages || 1,
                    })}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy || !launch.posts.pagination.hasNextPage}
                    onClick={() => void act(() => refresh({ page: launch.posts.pagination!.page + 1 }))}>
                    {t("nextPage")}
                  </Button>
                </div>
              ) : null}
              {launch.recovery.length > 0 ? (
                <details>
                  <summary>{t("recoverCopy")}</summary>
                  {launch.recovery.map((session) => (
                    <Button
                      variant="outline"
                      size="sm"
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
                      {session.message || t("untitledCopy")} · {new Date(session.updatedAt).toLocaleString(locale)}
                    </Button>
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
              ? t("selectedSlot", {
                  time:
                    locale === "en"
                      ? selected.localTime
                      : new Date(selected.at).toLocaleTimeString(locale, {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: launch.schedule.timeZone,
                        }),
                  zone: launch.schedule.timeZone,
                })
              : t("selectedPosts", { count: chosenPosts.length || 1 })}
          </strong>
          <div className="sp-actions">
            {selected?.postId ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!canCompose || busy}
                onClick={() => void act(() => openEditor(selected.postId!))}>
                {t("editSelectedPost")}
              </Button>
            ) : null}
            {selected?.kind === "slot" && !selected.isPast ? (
              <Button
                variant="outline"
                size="sm"
                className="sp-primary"
                disabled={!canCompose || busy}
                onClick={() =>
                  void act(async () => {
                    setSlotTime(selected.at);
                    await openEditor();
                  })
                }>
                {t("draftForSlot")}
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
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
              {t("askChatGpt")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSelected(null);
                setChosenPosts([]);
                if (app)
                  void act(async () => {
                    await attachSelection(app, null);
                  });
              }}>
              {t("clearSelection")}
            </Button>
          </div>
        </aside>
      ) : null}
    </main>
  );
  return (
    <UiLocaleProvider locale={locale} messages={messages}>
      {content}
    </UiLocaleProvider>
  );
}
