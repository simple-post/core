import { useCallback, useEffect, useRef, useState } from "react";

import { normalizePreviewPlatform } from "@simple-post/preview";
import { type PostPreviewData } from "@simple-post/preview-react";
import { CalendarClock, Send, Pencil, Save, ArrowLeft } from "lucide-react";

import { AccountRowPicker } from "../../components/account-row-picker";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { MessageComposer } from "../../components/visual/message-composer";
import { useUiTranslation } from "../../lib/i18n/client";
import { useUiCopy } from "../../lib/i18n/use-ui-copy";
import { PreviewSwitcher } from "../preview-switcher";

import { AccountIdentity, platformName } from "./account-identity";
import { askChat, attachSelection, callTool, keepEditorHint, restoreEditorHint } from "./host";
import { localDateTime } from "./timezone";

import type { EditorContent, EditorData, Validation, WorkspaceData } from "./types";
import type { MessageKey, MessageValues } from "../../lib/i18n/translate";
import type { App } from "@modelcontextprotocol/ext-apps";

function fingerprint(value: unknown) {
  return JSON.stringify(value);
}
const proposalFieldLabels: Record<string, MessageKey> = {
  accountIds: "destinations",
  media: "attachments",
  thread: "threadReplies",
  accountOptions: "publishOptions",
  quotePostId: "quotedPost",
  plannedSchedule: "plannedPublishingTime",
};
const youtubeAudience = {
  private: "audiencePrivate",
  unlisted: "audienceUnlisted",
  public: "audiencePublic",
} satisfies Record<string, MessageKey>;

type EditorNotice = string | { key: MessageKey; values?: MessageValues };
class EditorNoticeError extends Error {
  constructor(readonly key: MessageKey) {
    super(key);
  }
}
function noticeFor(error: unknown): EditorNotice {
  if (error instanceof EditorNoticeError) return { key: error.key };
  return error instanceof Error ? error.message : String(error);
}
type Proposal = { patch: Partial<EditorContent>; explanation: string; revision: number };
export function mergeProposal(content: EditorContent, patch: Partial<EditorContent>): EditorContent {
  return {
    ...content,
    ...patch,
    accountOptions: {
      ...content.accountOptions,
      ...Object.fromEntries(
        Object.entries(patch.accountOptions ?? {}).map(([id, options]) => [
          id,
          { ...content.accountOptions[id], ...options },
        ]),
      ),
    },
    accountOverrides: {
      ...content.accountOverrides,
      ...Object.fromEntries(
        Object.entries(patch.accountOverrides ?? {}).map(([id, value]) => [
          id,
          { ...content.accountOverrides[id], ...value },
        ]),
      ),
    },
  };
}

export function Editor({
  initial,
  app,
  accounts,
  timeZone: preferenceTimeZone,
  proposedTime,
  incoming,
  canValidate,
  canWrite,
  imageFittingEnabled,
  onClose,
  onCommitted,
}: {
  initial: EditorData;
  app: App;
  accounts: WorkspaceData["accounts"];
  timeZone: string;
  proposedTime: string | null;
  incoming: Record<string, unknown> | null;
  canValidate: boolean;
  canWrite: boolean;
  imageFittingEnabled: boolean;
  onClose: () => void;
  onCommitted: (editor: EditorData) => void;
}) {
  const { t, locale } = useUiTranslation();
  const { copy } = useUiCopy();
  const hint = restoreEditorHint();
  const recoverLocal = hint?.sessionId === initial.sessionId && hint.content;
  const [content, setContent] = useState<EditorContent>(() => {
    const base = recoverLocal ? (hint.content as EditorContent) : initial.content;
    return proposedTime && !base.plannedSchedule
      ? {
          ...base,
          plannedSchedule: {
            localTime: localDateTime(new Date(proposedTime), preferenceTimeZone),
            timeZone: preferenceTimeZone,
          },
        }
      : base;
  });
  const timeZone = content.plannedSchedule?.timeZone ?? preferenceTimeZone;
  const [session, setSession] = useState(initial);
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [notice, setNotice] = useState<EditorNotice>(
    recoverLocal && hint.revision !== initial.revision ? { key: "editorConflictReopened" } : "",
  );
  const [conflicted, setConflicted] = useState(!!recoverLocal && hint.revision !== initial.revision);
  const conflictRef = useRef(conflicted);
  conflictRef.current = conflicted;
  const [working, setWorking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [localTime, setLocalTime] = useState(
    content.plannedSchedule?.localTime ??
      (proposedTime
        ? localDateTime(new Date(proposedTime), timeZone)
        : initial.scheduledFor
          ? localDateTime(new Date(initial.scheduledFor), timeZone)
          : ""),
  );
  const [mediaUrl, setMediaUrl] = useState("");
  const [imageFit, setImageFit] = useState<"crop" | "blur" | "">("");
  const [review, setReview] = useState<"schedule" | "now" | null>(null);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [contextActive, setContextActive] = useState(true);
  const [manual, setManual] = useState(false);
  const deselectedOverrides = useRef<EditorContent["accountOverrides"]>({});
  const liveContent = useRef(content);
  const liveSession = useRef(session);
  const stored = useRef(fingerprint(initial.content));
  const queue = useRef<Promise<EditorData>>(Promise.resolve(initial));
  const mounted = useRef(true);
  liveContent.current = content;
  liveSession.current = session;
  const dirty = fingerprint(content) !== stored.current;
  const statusEditable =
    !["published", "pending", "failed"].includes(session.status ?? "new") &&
    !session.committing &&
    !conflicted &&
    canWrite;
  const proposal = session.proposal as Proposal | null;
  const variants = accounts.filter((account) => content.accountIds.includes(account.accountId));
  const selectedAccount = variants.find((account) => account.accountId === activeAccount);
  const override = activeAccount ? content.accountOverrides[activeAccount] : undefined;
  const displayedMessage = override?.message ?? content.message;
  const displayedThread = override?.thread ?? content.thread;
  const displayedMedia = override?.media ?? content.media;

  function change(next: EditorContent) {
    const updated = localTime && !next.plannedSchedule ? { ...next, plannedSchedule: { localTime, timeZone } } : next;
    liveContent.current = updated;
    setContent(updated);
    if (next.plannedSchedule) setLocalTime(next.plannedSchedule.localTime);
    setValidation(null);
    setReview(null);
  }
  function changeVariant(value: Partial<EditorContent>) {
    if (activeAccount) {
      change({
        ...content,
        accountOverrides: { ...content.accountOverrides, [activeAccount]: { ...override, ...value } },
      });
    } else {
      change({ ...content, ...value });
    }
  }
  const selection = useCallback(
    (editor = liveSession.current) => {
      const current = liveContent.current;
      const selected = activeAccount ? current.accountOverrides[activeAccount] : null;
      return {
        editorSessionId: editor.sessionId,
        postId: editor.postId,
        baseUpdatedAt: editor.baseUpdatedAt,
        expectedWorkingRevision: editor.revision,
        selectedAccountId: activeAccount,
        platform: selectedAccount?.platform ?? null,
        source: "working_copy",
        message: selected?.message ?? current.message,
        thread: selected?.thread ?? current.thread,
        media: (selected?.media ?? current.media).map(({ type, url }) => ({ type, url })),
        timeZone,
        proposedLocalTime: localTime || null,
        accountIds: current.accountIds,
      };
    },
    [activeAccount, selectedAccount?.platform, timeZone, localTime],
  );
  const flush = useCallback((): Promise<EditorData> => {
    const next = queue.current
      .catch(() => liveSession.current)
      .then(async () => {
        if (conflictRef.current) throw new EditorNoticeError("editorConflictSave");
        const snapshot = liveContent.current;
        if (fingerprint(snapshot) === stored.current) return liveSession.current;
        if (mounted.current) setSyncing(true);
        try {
          const editor = await callTool<EditorData>(app, "update_post_editor_session", {
            sessionId: liveSession.current.sessionId,
            expectedRevision: liveSession.current.revision,
            content: snapshot,
          });
          stored.current = fingerprint(snapshot);
          liveSession.current = editor;
          if (mounted.current) setSession(editor);
          keepEditorHint({ sessionId: editor.sessionId, content: liveContent.current, revision: editor.revision });
          return editor;
        } finally {
          if (mounted.current) setSyncing(false);
        }
      });
    queue.current = next;
    return next;
  }, [app]);
  async function act(action: () => Promise<void>) {
    setWorking(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(noticeFor(error));
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    keepEditorHint({
      sessionId: session.sessionId,
      content,
      revision: conflicted ? (hint?.revision ?? -1) : session.revision,
    });
    const timer = window.setTimeout(() => {
      if (statusEditable)
        void flush().catch((error: Error) => {
          if (mounted.current)
            setNotice(
              error instanceof EditorNoticeError
                ? noticeFor(error)
                : { key: "editorAutosaveFailed", values: { error: error.message } },
            );
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [content, session.sessionId, session.revision, statusEditable, flush, conflicted, hint?.revision]);
  useEffect(() => {
    const onContext = (context: Record<string, unknown>) => {
      if (context["openai/modelContext"] === null) setContextActive(false);
    };
    app.addEventListener("hostcontextchanged", onContext);
    return () => app.removeEventListener("hostcontextchanged", onContext);
  }, [app]);
  useEffect(() => {
    if (!contextActive) return;
    const timer = window.setTimeout(() => {
      void flush()
        .then((editor) => attachSelection(app, selection(editor)))
        .catch((error: Error) => setNotice(noticeFor(error)));
    }, 850);
    return () => window.clearTimeout(timer);
  }, [content, contextActive, app, flush, selection]);
  useEffect(() => {
    if (!incoming || incoming.sessionId !== liveSession.current.sessionId) return;
    if (incoming.revision === liveSession.current.revision)
      setSession((current) => ({ ...current, proposal: incoming.proposal ?? null }));
  }, [incoming]);
  useEffect(() => {
    let cancelled = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || syncing || working) return;
      void callTool<EditorData>(app, "read_post_editor_session", { sessionId: initial.sessionId })
        .then((next) => {
          if (cancelled) return;
          if (next.revision === liveSession.current.revision)
            setSession((current) => ({
              ...current,
              proposal: next.proposal,
              remotelyChanged: next.remotelyChanged,
              committing: next.committing,
              status: next.status,
            }));
          else if (fingerprint(liveContent.current) === stored.current) {
            liveSession.current = next;
            stored.current = fingerprint(next.content);
            setSession(next);
            setContent(next.content);
          } else {
            setConflicted(true);
            setNotice({ key: "editorConflictOtherView" });
          }
        })
        .catch(() => {
          /* Explicit refresh reports errors without interrupting typing. */
        });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [app, initial.sessionId, syncing, working]);
  async function commit(mode: "draft" | "schedule" | "now") {
    const editor = await flush();
    const response = await callTool<{ editor: EditorData; outcome: Record<string, unknown> }>(
      app,
      "commit_post_editor_session",
      {
        sessionId: editor.sessionId,
        expectedRevision: editor.revision,
        mode,
        ...(mode === "schedule" ? { scheduledLocal: localTime, timeZone } : {}),
        ...(imageFit ? { imageFit } : {}),
      },
    );
    liveSession.current = response.editor;
    stored.current = fingerprint(response.editor.content);
    setContent(response.editor.content);
    setSession(response.editor);
    setResults(response.outcome);
    setReview(null);
    setValidation(null);
    keepEditorHint({ sessionId: response.editor.sessionId, revision: response.editor.revision });
    setNotice({
      key:
        mode === "draft"
          ? "editorDraftSaved"
          : mode === "schedule"
            ? "editorScheduled"
            : response.editor.status === "published"
              ? "editorAllPublished"
              : "editorSomeFailed",
    });
    onCommitted(response.editor);
  }
  const options = activeAccount ? (content.accountOptions[activeAccount] ?? {}) : {};
  function option(name: string, value: unknown) {
    if (activeAccount)
      change({
        ...content,
        accountOptions: { ...content.accountOptions, [activeAccount]: { ...options, [name]: value } },
      });
  }
  return (
    <section className="sp-editor" aria-label={t("postEditor")}>
      <header className="sp-editor-header">
        <div>
          <h1 className="sp-kicker">{session.postId ? t("editPost") : t("newDraft")}</h1>
          <span aria-live="polite">
            {syncing
              ? t("keepingCopy")
              : dirty
                ? t("unsavedChanges")
                : session.status === "new"
                  ? t("copySavedDraftNot")
                  : t("workingCopySaved")}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() =>
            void act(async () => {
              if (canWrite && !conflicted) await flush();
              if (!dirty || (canWrite && !conflicted)) keepEditorHint({});
              await attachSelection(app, null);
              onClose();
            })
          }>
          <ArrowLeft size={14} /> {t("backWorkspace")}
        </Button>
      </header>
      {notice ? (
        <div role="status" className="sp-notice">
          {typeof notice === "string" ? notice : t(notice.key, notice.values)}
        </div>
      ) : null}
      {conflicted ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "simplepost-working-copy.json";
            link.click();
            URL.revokeObjectURL(url);
          }}>
          {t("downloadLocalEdits")}
        </Button>
      ) : null}
      {canValidate ? null : <div className="sp-notice">{t("editorValidationPermission")}</div>}
      {session.committing ? (
        <div className="sp-notice" role="alert">
          {t("editorCommitBusy")}
        </div>
      ) : null}
      {session.remotelyChanged ? (
        <div className="sp-notice" role="alert">
          {t("editorRemoteChanged")}
        </div>
      ) : null}
      {proposal ? (
        <section className="sp-proposal">
          <h2>{t("proposedChanges")}</h2>
          <p>{proposal.explanation}</p>
          <details open>
            <summary>{t("reviewChanges")}</summary>
            {proposal.patch.message === undefined ? null : (
              <div className="sp-diff">
                <div>
                  <strong>{t("currentShared")}</strong>
                  <pre dir="auto">{content.message}</pre>
                </div>
                <div>
                  <strong>{t("proposedShared")}</strong>
                  <pre dir="auto">{proposal.patch.message}</pre>
                </div>
              </div>
            )}
            {Object.entries(proposal.patch.accountOverrides ?? {}).map(([id, proposed]) => (
              <div className="sp-diff" key={id}>
                <div>
                  <strong>
                    {t("currentDestination", {
                      destination:
                        platformName(accounts.find((a) => a.accountId === id)?.platform ?? "") || t("destination"),
                    })}
                  </strong>
                  <pre dir="auto">
                    {content.accountOverrides[id]?.message ?? content.message}
                    {(content.accountOverrides[id]?.thread ?? content.thread)
                      .map((part) => `\n\n${part.message}`)
                      .join("")}
                  </pre>
                </div>
                <div>
                  <strong>{t("proposed")}</strong>
                  <pre dir="auto">
                    {proposed.message ?? content.accountOverrides[id]?.message ?? content.message}
                    {(proposed.thread ?? content.accountOverrides[id]?.thread ?? content.thread)
                      .map((part) => `\n\n${part.message}`)
                      .join("")}
                  </pre>
                </div>
              </div>
            ))}
            {Object.keys(proposal.patch).some((key) => !["message", "accountOverrides"].includes(key)) ? (
              <p>
                {t("proposalOtherChanges", {
                  fields: new Intl.ListFormat(locale).format(
                    Object.keys(proposal.patch)
                      .filter((key) => Object.hasOwn(proposalFieldLabels, key))
                      .map((key) => t(proposalFieldLabels[key])),
                  ),
                })}
              </p>
            ) : null}
          </details>
          <Button
            size="sm"
            disabled={working || !statusEditable || dirty || proposal.revision !== session.revision}
            variant="default"
            onClick={() => change(mergeProposal(content, proposal.patch))}>
            {t("applyToCopy")}
          </Button>
          <span>{t("applyDoesNotPublish")}</span>
        </section>
      ) : null}
      <footer className="sp-editor-footer">
        <div className="sp-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={working || !statusEditable || !canValidate || content.accountIds.length === 0}
            onClick={() =>
              void act(async () => {
                const next = await flush();
                setValidation(
                  await callTool<Validation>(app, "validate_post_editor_session", {
                    sessionId: next.sessionId,
                    expectedRevision: next.revision,
                    ...(imageFit ? { imageFit } : {}),
                  }),
                );
              })
            }>
            {t("checkRules")}
          </Button>
          <Button
            size="sm"
            variant="default"
            disabled={working || !statusEditable || !canValidate || content.accountIds.length === 0}
            onClick={() => void act(() => commit("draft"))}>
            <Save size={14} /> {session.status === "scheduled" ? t("moveToDrafts") : t("saveDraft")}
          </Button>
        </div>
        <div className="sp-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={working || !statusEditable || !canValidate || content.accountIds.length === 0}
            onClick={() => setReview("schedule")}>
            <CalendarClock size={14} /> {t("scheduleAction")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={working || !statusEditable || !canValidate || content.accountIds.length === 0}
            onClick={() => setReview("now")}>
            <Send size={14} /> {t("postNow")}
          </Button>
        </div>
        <div className="sp-actions">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={manual}
            aria-controls="sp-manual-editor"
            onClick={() => setManual(!manual)}>
            <Pencil size={14} /> {manual ? t("manualEditorHide") : t("editManually")}
          </Button>
        </div>
      </footer>
      <div className={manual ? "sp-editor-grid is-manual" : "sp-editor-grid"}>
        {manual ? (
          <div className="sp-compose" id="sp-manual-editor">
            <div className="sp-variant-tabs" aria-label={t("editVariant")}>
              <Button
                variant="outline"
                size="sm"
                aria-pressed={!activeAccount}
                onClick={() => {
                  setActiveAccount(null);
                  setContextActive(true);
                }}>
                {t("sharedContent")}
              </Button>
              {variants.map((account) => (
                <Button
                  variant="outline"
                  size="sm"
                  key={account.accountId}
                  aria-pressed={activeAccount === account.accountId}
                  onClick={() => {
                    setActiveAccount(account.accountId);
                    setContextActive(true);
                  }}>
                  {account.platform} · {account.displayName ?? account.username ?? t("mcpUnnamedAccount")}
                </Button>
              ))}
            </div>
            {activeAccount ? (
              <p>
                {override ? t("customDestination") : t("inheritsShared")}{" "}
                {override ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={working || !statusEditable}
                    onClick={() =>
                      change({
                        ...content,
                        accountOverrides: Object.fromEntries(
                          Object.entries(content.accountOverrides).filter(([id]) => id !== activeAccount),
                        ),
                      })
                    }>
                    {t("useShared")}
                  </Button>
                ) : null}
              </p>
            ) : null}
            <fieldset disabled={!statusEditable || working}>
              <legend>
                {selectedAccount
                  ? t("platformVersion", { platform: platformName(selectedAccount.platform) })
                  : t("sharedPost")}
              </legend>
              <MessageComposer
                id="sp-post-text"
                label={t("postText")}
                dir="auto"
                message={displayedMessage}
                maxLength={100_000}
                onMessageChange={(message) => changeVariant({ message })}
                onFocus={() => setContextActive(true)}
              />
              <div className="sp-thread">
                <h3>{t("threadReplies")}</h3>
                {displayedThread.map((part, index) => (
                  <div key={index}>
                    <label>
                      {t("replyNumber", { index: index + 1 })}
                      <Textarea
                        rows={3}
                        dir="auto"
                        value={part.message}
                        onChange={(event) =>
                          changeVariant({
                            thread: displayedThread.map((segment, i) =>
                              i === index ? { ...segment, message: event.target.value } : segment,
                            ),
                          })
                        }
                      />
                    </label>
                    {part.media?.length ? (
                      <small>{t("attachmentsPreserved", { count: part.media.length })}</small>
                    ) : null}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => changeVariant({ thread: displayedThread.filter((_, i) => i !== index) })}>
                      {t("removeReply")}
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={displayedThread.length >= 24}
                  onClick={() => changeVariant({ thread: [...displayedThread, { message: "" }] })}>
                  {t("addReply")}
                </Button>
              </div>
              <div className="sp-media">
                <h3>{t("media")}</h3>
                {displayedMedia.map((file) => (
                  <div key={file.id}>
                    <span>
                      <bdi>{file.filename}</bdi> · {file.type === "video" ? t("video") : t("image")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => changeVariant({ media: displayedMedia.filter((item) => item.id !== file.id) })}>
                      {t("remove")}
                    </Button>
                  </div>
                ))}
                <label>
                  {t("mediaUrl")}
                  <Input
                    type="url"
                    value={mediaUrl}
                    onChange={(event) => setMediaUrl(event.target.value)}
                    placeholder="https://…"
                  />
                </label>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!mediaUrl}
                  onClick={() =>
                    void act(async () => {
                      const uploaded = await callTool<{
                        url: string;
                        type: "image" | "video";
                        filename: string;
                        size: number;
                        mimeType: string;
                      }>(app, "upload_media", { url: mediaUrl });
                      changeVariant({
                        media: [
                          ...displayedMedia,
                          {
                            id: crypto.randomUUID(),
                            url: uploaded.url,
                            type: uploaded.type,
                            filename: uploaded.filename,
                            size: uploaded.size,
                            contentType: uploaded.mimeType,
                          },
                        ],
                      });
                      setMediaUrl("");
                    })
                  }>
                  {t("importMedia")}
                </Button>
                <small>{t("importChatMedia")}</small>
              </div>
              {selectedAccount ? (
                <details className="sp-options">
                  <summary>{t("platformOptions", { platform: platformName(selectedAccount.platform) })}</summary>
                  {["youtube", "pinterest", "tiktok", "forem"].includes(selectedAccount.platform) ? (
                    <label>
                      {t("title")}
                      <Input
                        value={typeof options.title === "string" ? options.title : ""}
                        onChange={(event) => option("title", event.target.value)}
                      />
                    </label>
                  ) : null}
                  {selectedAccount.platform === "youtube" ? (
                    <>
                      <label>
                        {t("audience")}
                        <select
                          value={String(options.privacyStatus ?? "private")}
                          onChange={(event) => option("privacyStatus", event.target.value)}>
                          {Object.entries(youtubeAudience).map(([value, key]) => (
                            <option key={value} value={value}>
                              {t(key)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={options.selfDeclaredMadeForKids === true}
                          onChange={(event) => option("selfDeclaredMadeForKids", event.target.checked)}
                        />

                        {t("madeForKids")}
                      </label>
                    </>
                  ) : null}
                  {selectedAccount.platform === "linkedin" ? (
                    <label>
                      {t("audience")}
                      <select
                        value={String(options.visibility ?? "PUBLIC")}
                        onChange={(event) => option("visibility", event.target.value)}>
                        <option value="PUBLIC">{t("audiencePublic")}</option>
                        <option value="CONNECTIONS">{t("audienceConnections")}</option>
                      </select>
                    </label>
                  ) : null}
                  {selectedAccount.platform === "tiktok" ? (
                    <>
                      <label>
                        {t("postingDestination")}
                        <select
                          value={String(options.publishMode ?? "public")}
                          onChange={(event) => option("publishMode", event.target.value)}>
                          <option value="public">{t("publishDirectly")}</option>
                          <option value="draft">{t("tiktokInbox")}</option>
                        </select>
                      </label>
                      <label>
                        {t("audience")}
                        <select
                          value={String(options.privacyLevel ?? "PUBLIC_TO_EVERYONE")}
                          onChange={(event) => option("privacyLevel", event.target.value)}>
                          <option value="PUBLIC_TO_EVERYONE">{t("audiencePublic")}</option>
                          <option value="SELF_ONLY">{t("audienceOnlyMe")}</option>
                          <option value="MUTUAL_FOLLOW_FRIENDS">{t("audienceFriends")}</option>
                          <option value="FOLLOWER_OF_CREATOR">{t("audienceFollowers")}</option>
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={options.autoAddMusic !== false}
                          onChange={(event) => option("autoAddMusic", event.target.checked)}
                        />

                        {t("addMusic")}
                      </label>
                    </>
                  ) : null}
                  {selectedAccount.platform === "pinterest" ? (
                    <>
                      <label>
                        {t("boardId")}
                        <Input
                          value={String(options.boardId ?? "")}
                          onChange={(event) => option("boardId", event.target.value)}
                        />
                      </label>
                      <label>
                        {t("destinationLink")}
                        <Input
                          type="url"
                          value={String(options.link ?? "")}
                          onChange={(event) => option("link", event.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                  {selectedAccount.platform === "telegram" ? (
                    <label>
                      {t("textFormat")}
                      <select
                        value={String(options.parseMode ?? "HTML")}
                        onChange={(event) => option("parseMode", event.target.value)}>
                        {["HTML", "Markdown", "MarkdownV2"].map((value) => (
                          <option key={value}>{value}</option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </details>
              ) : null}
            </fieldset>
            <div className="sp-ai-actions">
              <Button
                variant="outline"
                size="sm"
                disabled={working || !statusEditable}
                onClick={() =>
                  void act(async () => {
                    const next = await flush();
                    setContextActive(true);
                    await askChat(
                      app,
                      selectedAccount?.platform
                        ? copy(
                            "Propose a shorter {{platform}} version. Preserve other variants, media and publishing time. Use propose_post_edit for this editor.",
                            { platform: selectedAccount.platform },
                          )
                        : copy(
                            "Propose a shorter shared version. Preserve other variants, media and publishing time. Use propose_post_edit for this editor.",
                          ),
                      selection(next),
                    );
                  })
                }>
                {t("askShorten")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={working || !statusEditable}
                onClick={() =>
                  void act(async () => {
                    const next = await flush();
                    setContextActive(true);
                    await askChat(
                      app,
                      copy(
                        "Propose writing tailored to each selected destination. Keep one SimplePost post and preserve media. Do not publish or schedule.",
                      ),
                      selection(next),
                    );
                  })
                }>
                {t("askPlatformVersions")}
              </Button>
            </div>
          </div>
        ) : null}
        <aside className="sp-live-previews">
          <div className="sp-preview-heading">
            <h2 className="sp-kicker">{t("platformPreview")}</h2>
            <span>
              {platformName((variants.find((a) => a.accountId === activeAccount) ?? variants[0])?.platform ?? "")}
            </span>
          </div>
          <PreviewSwitcher
            selectedId={activeAccount}
            onSelect={(id) => {
              setActiveAccount(id);
              setContextActive(true);
            }}
            items={variants.flatMap((account) => {
              const platform = normalizePreviewPlatform(account.platform);
              const variant = content.accountOverrides[account.accountId];
              if (!platform) return [];
              const preview: PostPreviewData = {
                platform,
                account: {
                  id: account.accountId,
                  platform,
                  displayName: account.displayName ?? account.username ?? account.platform,
                  username: account.username,
                  profilePicture: account.profilePicture ?? null,
                },
                message: variant?.message ?? content.message,
                media: (variant?.media ?? content.media).map((file) => ({
                  ...file,
                  thumbnailUrl: file.thumbnailUrl ?? null,
                })),
                thread: (variant?.thread ?? content.thread).map((part) => ({
                  ...part,
                  media: (part.media ?? []).map((file) => ({ ...file, thumbnailUrl: file.thumbnailUrl ?? null })),
                })),
                options: content.accountOptions[account.accountId] ?? {},
                previewDate: new Date(),
                threadLayout: "scroll",
              };
              return [
                {
                  id: account.accountId,
                  platform,
                  platformLabel:
                    platform === "x"
                      ? "X"
                      : platform === "linkedin"
                        ? "LinkedIn"
                        : platform[0].toUpperCase() + platform.slice(1),
                  accountLabel: account.displayName ?? account.username ?? t("mcpUnnamedAccount"),
                  data: preview,
                },
              ];
            })}
          />
        </aside>
      </div>
      <div className="sp-editor-destinations">
        <AccountRowPicker
          selectedIds={content.accountIds}
          onToggle={(id) => {
            const current = liveContent.current;
            const selected = current.accountIds.includes(id);
            if (selected) {
              if (current.accountOverrides[id]) deselectedOverrides.current[id] = current.accountOverrides[id];
              else delete deselectedOverrides.current[id];
            }
            const accountIds = selected
              ? current.accountIds.filter((value) => value !== id)
              : [...current.accountIds, id];
            const accountOverrides = Object.fromEntries(
              Object.entries(current.accountOverrides).filter(([key]) => accountIds.includes(key)),
            );
            if (!selected && deselectedOverrides.current[id]) accountOverrides[id] = deselectedOverrides.current[id];
            change({ ...current, accountIds, accountOverrides });
            if (selected && activeAccount === id) setActiveAccount(null);
            setContextActive(true);
          }}
          items={accounts.map((account) => ({
            id: account.accountId,
            platform: account.platform,
            label:
              ["x", "instagram", "tiktok", "bluesky", "threads"].includes(account.platform) && account.username
                ? `@${account.username.replace(/^@/, "")}`
                : account.displayName ||
                  (account.username ? `@${account.username.replace(/^@/, "")}` : platformName(account.platform)),
            accessibleLabel: `${platformName(account.platform)}: ${account.displayName ?? account.username ?? account.platform}`,
            avatar: <AccountIdentity account={account} />,
            disabled: !statusEditable || working,
          }))}
        />
      </div>
      {validation ? (
        <section className="sp-validation" aria-live="polite">
          <h2>{validation.summary.isValid ? t("readyToPublish") : t("changesBeforePublish")}</h2>
          {validation.accounts.flatMap((account) =>
            [
              ...account.errors.map((item) => ({ ...item, tone: "error" })),
              ...account.warnings.map((item) => ({ ...item, tone: "warning" })),
            ].map((item, index) => (
              <p key={`${account.accountId}:${index}`} className={item.tone}>
                {accounts.find((a) => a.accountId === account.accountId)?.platform}: {item.message}
              </p>
            )),
          )}
        </section>
      ) : null}
      {results && Array.isArray(results.postingResults) ? (
        <section className="sp-validation">
          <h2>{t("publishingResults")}</h2>
          {results.postingResults.map(
            (result: {
              accountId: string;
              platform: string;
              success: boolean;
              message?: string;
              error?: string;
              postUrl?: string;
            }) => (
              <p key={result.accountId}>
                {result.platform}:{" "}
                {result.success ? t("postPublished") : (result.message ?? result.error ?? t("postFailed"))}
                {result.postUrl ? (
                  <Button variant="outline" size="sm" onClick={() => void app.openLink({ url: result.postUrl! })}>
                    {t("openPublished")}
                  </Button>
                ) : null}
              </p>
            ),
          )}
        </section>
      ) : null}
      {imageFittingEnabled && manual ? (
        <label>
          {t("imageFitting")}
          <select
            value={imageFit}
            disabled={working || !statusEditable}
            onChange={(event) => {
              setImageFit(event.target.value as "crop" | "blur" | "");
              setValidation(null);
              setReview(null);
            }}>
            <option value="">{t("imageOriginal")}</option>
            <option value="crop">{t("imageCrop")}</option>
            <option value="blur">{t("imageBlur")}</option>
          </select>
        </label>
      ) : null}

      {review ? (
        <section className="sp-publish-review" role="region" aria-label={t("reviewPublishing")}>
          {review === "schedule" ? (
            <label>
              {t("publishingTime", { zone: timeZone })}
              <Input
                type="datetime-local"
                dir="ltr"
                value={localTime}
                disabled={working || !statusEditable}
                onChange={(event) => {
                  setLocalTime(event.target.value);
                  change({ ...content, plannedSchedule: { localTime: event.target.value, timeZone } });
                  setReview("schedule");
                }}
              />
            </label>
          ) : null}
          <h2>
            {review === "schedule"
              ? t("scheduleReview", {
                  date:
                    locale === "en" || !localTime
                      ? localTime.replace("T", " ")
                      : new Date(`${localTime}Z`).toLocaleString(locale, {
                          timeZone: "UTC",
                          dateStyle: "medium",
                          timeStyle: "short",
                        }),
                  zone: timeZone,
                })
              : t("postNow")}
          </h2>
          <p>
            {t("publishReviewIntro", {
              destinations: new Intl.ListFormat(locale).format(
                variants.map(
                  (account) =>
                    `${platformName(account.platform)} (${account.displayName ?? account.username ?? t("user")})`,
                ),
              ),
            })}
          </p>
          <Button
            size="sm"
            variant="default"
            disabled={working || (review === "schedule" && !localTime)}
            onClick={() => void act(() => commit(review))}>
            {review === "schedule" ? t("confirmSchedule") : t("confirmPublishNow")}
          </Button>
          <Button variant="outline" size="sm" disabled={working} onClick={() => setReview(null)}>
            {t("keepEditing")}
          </Button>
        </section>
      ) : null}
    </section>
  );
}
