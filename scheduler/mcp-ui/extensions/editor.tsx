import { useCallback, useEffect, useRef, useState } from "react";

import { normalizePreviewPlatform } from "@simple-post/preview";
import { type PostPreviewData } from "@simple-post/preview-react";

import { PlatformIcon } from "../../components/platform-icon";
import { PreviewSwitcher } from "../preview-switcher";

import { askChat, attachSelection, callTool, keepEditorHint, restoreEditorHint } from "./host";
import { localDateTime } from "./timezone";

import type { EditorContent, EditorData, Validation, WorkspaceData } from "./types";
import type { App } from "@modelcontextprotocol/ext-apps";

function fingerprint(value: unknown) {
  return JSON.stringify(value);
}
const proposalFieldLabels: Record<string, string> = {
  accountIds: "destinations",
  media: "attachments",
  thread: "thread replies",
  accountOptions: "publishing options",
  quotePostId: "quoted post",
  plannedSchedule: "planned publishing time",
};
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
  const [notice, setNotice] = useState(
    recoverLocal && hint.revision !== initial.revision
      ? "This working copy changed while the editor was closed. Your local edits are shown for comparison; saving is paused."
      : "",
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
    setContent(localTime && !next.plannedSchedule ? { ...next, plannedSchedule: { localTime, timeZone } } : next);
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
        if (conflictRef.current)
          throw new Error("Your local edits are preserved. Compare with the recovered server copy before saving.");
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
      setNotice(error instanceof Error ? error.message : String(error));
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
            setNotice(`Your changes are still here. Working copy could not be saved: ${error.message}`);
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
        .catch((error: Error) => setNotice(error.message));
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
            setNotice("This working copy changed in another view. Your local edits are safe; compare before saving.");
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
    setNotice(
      mode === "draft"
        ? "Draft saved. Nothing will be published."
        : mode === "schedule"
          ? "Post scheduled."
          : response.editor.status === "published"
            ? "Published to all destinations."
            : "Some destinations did not publish. Review the results before retrying.",
    );
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
    <section className="sp-editor" aria-label="Post editor">
      <header className="sp-editor-header">
        <div>
          <h1>{session.postId ? "Edit post" : "New draft"}</h1>
          <span aria-live="polite">
            {syncing
              ? "Keeping working copy…"
              : dirty
                ? "Unsaved changes"
                : session.status === "new"
                  ? "Working copy saved · draft not saved yet"
                  : "Working copy saved"}
          </span>
        </div>
        <button
          disabled={working}
          onClick={() =>
            void act(async () => {
              if (canWrite && !conflicted) await flush();
              if (!dirty || (canWrite && !conflicted)) keepEditorHint({});
              await attachSelection(app, null);
              onClose();
            })
          }>
          Back to workspace
        </button>
      </header>
      {notice ? (
        <div role="status" className="sp-notice">
          {notice}
        </div>
      ) : null}
      {conflicted ? (
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = "simplepost-working-copy.json";
            link.click();
            URL.revokeObjectURL(url);
          }}>
          Download preserved local edits
        </button>
      ) : null}
      {canValidate ? null : (
        <div className="sp-notice">
          Reconnect SimplePost with permission to validate posts before saving or publishing from the editor.
        </div>
      )}
      {session.committing ? (
        <div className="sp-notice" role="alert">
          A save or publish is being processed. Refresh to check its outcome. If this remains locked, inspect the saved
          post in SimplePost before opening a fresh working copy.
        </div>
      ) : null}
      {session.remotelyChanged ? (
        <div className="sp-notice" role="alert">
          The saved post has changed. Your working copy is safe. Open a fresh editor from the saved post to compare
          before saving.
        </div>
      ) : null}
      {proposal ? (
        <section className="sp-proposal">
          <h2>Proposed writing changes</h2>
          <p>{proposal.explanation}</p>
          <details open>
            <summary>Review changes</summary>
            {proposal.patch.message === undefined ? null : (
              <div className="sp-diff">
                <div>
                  <strong>Current shared text</strong>
                  <pre>{content.message}</pre>
                </div>
                <div>
                  <strong>Proposed shared text</strong>
                  <pre>{proposal.patch.message}</pre>
                </div>
              </div>
            )}
            {Object.entries(proposal.patch.accountOverrides ?? {}).map(([id, proposed]) => (
              <div className="sp-diff" key={id}>
                <div>
                  <strong>{accounts.find((a) => a.accountId === id)?.platform ?? "Destination"} · current</strong>
                  <pre>
                    {content.accountOverrides[id]?.message ?? content.message}
                    {(content.accountOverrides[id]?.thread ?? content.thread)
                      .map((part) => `\n\n${part.message}`)
                      .join("")}
                  </pre>
                </div>
                <div>
                  <strong>Proposed</strong>
                  <pre>
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
                This proposal also changes:{" "}
                {Object.keys(proposal.patch)
                  .filter((key) => !["message", "accountOverrides"].includes(key))
                  .map((key) => proposalFieldLabels[key])
                  .join(", ")}
                . Preview the working copy after applying, before saving.
              </p>
            ) : null}
          </details>
          <button
            disabled={working || !statusEditable || dirty || proposal.revision !== session.revision}
            className="sp-primary"
            onClick={() => change(mergeProposal(content, proposal.patch))}>
            Apply to working copy
          </button>
          <span>Applying does not save or publish the post.</span>
        </section>
      ) : null}
      <div className="sp-editor-destinations">
        <fieldset disabled={!statusEditable || working}>
          <legend>Destinations</legend>
          <div className="sp-destinations">
            {accounts.map((account) => (
              <label key={account.accountId}>
                <input
                  type="checkbox"
                  checked={content.accountIds.includes(account.accountId)}
                  onChange={(event) => {
                    const ids = event.target.checked
                      ? [...content.accountIds, account.accountId]
                      : content.accountIds.filter((id) => id !== account.accountId);
                    change({
                      ...content,
                      accountIds: ids,
                      accountOverrides: Object.fromEntries(
                        Object.entries(content.accountOverrides).filter(([id]) => ids.includes(id)),
                      ),
                    });
                    if (!event.target.checked && activeAccount === account.accountId) setActiveAccount(null);
                  }}
                />
                <PlatformIcon platform={account.platform} className="sp-platform-icon" />
                <span>{account.displayName ?? account.username ?? account.platform}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sp-editor-controls">
          <p>Describe your post in chat. Review it here on every destination.</p>
          <button aria-expanded={manual} aria-controls="sp-manual-editor" onClick={() => setManual(!manual)}>
            {manual ? "Hide manual editor" : "Edit manually"}
          </button>
        </div>
      </div>
      <div className={manual ? "sp-editor-grid is-manual" : "sp-editor-grid"}>
        {manual ? (
          <div className="sp-compose" id="sp-manual-editor">
            <div className="sp-variant-tabs" aria-label="Edit destination variant">
              <button
                aria-pressed={!activeAccount}
                onClick={() => {
                  setActiveAccount(null);
                  setContextActive(true);
                }}>
                Shared content
              </button>
              {variants.map((account) => (
                <button
                  key={account.accountId}
                  aria-pressed={activeAccount === account.accountId}
                  onClick={() => {
                    setActiveAccount(account.accountId);
                    setContextActive(true);
                  }}>
                  {account.platform} · {account.displayName ?? account.username ?? "account"}
                </button>
              ))}
            </div>
            {activeAccount ? (
              <p>
                {override
                  ? "Custom content for this destination."
                  : "This destination inherits the shared content. Editing creates a custom version."}{" "}
                {override ? (
                  <button
                    disabled={working || !statusEditable}
                    onClick={() =>
                      change({
                        ...content,
                        accountOverrides: Object.fromEntries(
                          Object.entries(content.accountOverrides).filter(([id]) => id !== activeAccount),
                        ),
                      })
                    }>
                    Use shared content
                  </button>
                ) : null}
              </p>
            ) : null}
            <fieldset disabled={!statusEditable || working}>
              <legend>{selectedAccount ? `${selectedAccount.platform} version` : "Shared post"}</legend>
              <label>
                Post text
                <textarea
                  aria-label="Post text"
                  value={displayedMessage}
                  maxLength={100_000}
                  rows={9}
                  onChange={(event) => changeVariant({ message: event.target.value })}
                  onFocus={() => setContextActive(true)}
                />
              </label>
              <small>{displayedMessage.length.toLocaleString()} characters</small>
              <div className="sp-thread">
                <h3>Thread replies</h3>
                {displayedThread.map((part, index) => (
                  <div key={index}>
                    <label>
                      Reply {index + 1}
                      <textarea
                        rows={3}
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
                    {part.media?.length ? <small>{part.media.length} existing attachment(s) preserved</small> : null}
                    <button onClick={() => changeVariant({ thread: displayedThread.filter((_, i) => i !== index) })}>
                      Remove reply
                    </button>
                  </div>
                ))}
                <button
                  disabled={displayedThread.length >= 24}
                  onClick={() => changeVariant({ thread: [...displayedThread, { message: "" }] })}>
                  Add reply
                </button>
              </div>
              <div className="sp-media">
                <h3>Media</h3>
                {displayedMedia.map((file) => (
                  <div key={file.id}>
                    <span>
                      {file.filename} · {file.type}
                    </span>
                    <button
                      onClick={() => changeVariant({ media: displayedMedia.filter((item) => item.id !== file.id) })}>
                      Remove
                    </button>
                  </div>
                ))}
                <label>
                  Image or video URL
                  <input
                    type="url"
                    value={mediaUrl}
                    onChange={(event) => setMediaUrl(event.target.value)}
                    placeholder="https://…"
                  />
                </label>
                <button
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
                  Import media
                </button>
                <small>
                  Media from chat can also be imported by your assistant. Original attachments are retained while
                  editing.
                </small>
              </div>
              {selectedAccount ? (
                <details className="sp-options">
                  <summary>{selectedAccount.platform} publishing options</summary>
                  {["youtube", "pinterest", "tiktok", "forem"].includes(selectedAccount.platform) ? (
                    <label>
                      Title
                      <input
                        value={typeof options.title === "string" ? options.title : ""}
                        onChange={(event) => option("title", event.target.value)}
                      />
                    </label>
                  ) : null}
                  {selectedAccount.platform === "youtube" ? (
                    <>
                      <label>
                        Audience
                        <select
                          value={String(options.privacyStatus ?? "private")}
                          onChange={(event) => option("privacyStatus", event.target.value)}>
                          {["private", "unlisted", "public"].map((value) => (
                            <option key={value}>{value}</option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={options.selfDeclaredMadeForKids === true}
                          onChange={(event) => option("selfDeclaredMadeForKids", event.target.checked)}
                        />
                        Made for kids
                      </label>
                    </>
                  ) : null}
                  {selectedAccount.platform === "linkedin" ? (
                    <label>
                      Audience
                      <select
                        value={String(options.visibility ?? "PUBLIC")}
                        onChange={(event) => option("visibility", event.target.value)}>
                        <option value="PUBLIC">Public</option>
                        <option value="CONNECTIONS">Connections</option>
                      </select>
                    </label>
                  ) : null}
                  {selectedAccount.platform === "tiktok" ? (
                    <>
                      <label>
                        Posting destination
                        <select
                          value={String(options.publishMode ?? "public")}
                          onChange={(event) => option("publishMode", event.target.value)}>
                          <option value="public">Publish directly</option>
                          <option value="draft">TikTok inbox for manual editing</option>
                        </select>
                      </label>
                      <label>
                        Audience
                        <select
                          value={String(options.privacyLevel ?? "PUBLIC_TO_EVERYONE")}
                          onChange={(event) => option("privacyLevel", event.target.value)}>
                          <option value="PUBLIC_TO_EVERYONE">Public</option>
                          <option value="SELF_ONLY">Only me</option>
                          <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                          <option value="FOLLOWER_OF_CREATOR">Followers</option>
                        </select>
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          checked={options.autoAddMusic !== false}
                          onChange={(event) => option("autoAddMusic", event.target.checked)}
                        />
                        Add recommended music to photos
                      </label>
                    </>
                  ) : null}
                  {selectedAccount.platform === "pinterest" ? (
                    <>
                      <label>
                        Board ID
                        <input
                          value={String(options.boardId ?? "")}
                          onChange={(event) => option("boardId", event.target.value)}
                        />
                      </label>
                      <label>
                        Destination link
                        <input
                          type="url"
                          value={String(options.link ?? "")}
                          onChange={(event) => option("link", event.target.value)}
                        />
                      </label>
                    </>
                  ) : null}
                  {selectedAccount.platform === "telegram" ? (
                    <label>
                      Text format
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
              <button
                disabled={working || !statusEditable}
                onClick={() =>
                  void act(async () => {
                    const next = await flush();
                    setContextActive(true);
                    await askChat(
                      app,
                      `Propose a shorter ${selectedAccount?.platform ?? "shared"} version. Preserve other variants, media and publishing time. Use propose_post_edit for this editor.`,
                      selection(next),
                    );
                  })
                }>
                Ask ChatGPT to shorten
              </button>
              <button
                disabled={working || !statusEditable}
                onClick={() =>
                  void act(async () => {
                    const next = await flush();
                    setContextActive(true);
                    await askChat(
                      app,
                      "Propose writing tailored to each selected destination. Keep one SimplePost post and preserve media. Do not publish or schedule.",
                      selection(next),
                    );
                  })
                }>
                Ask for platform versions
              </button>
            </div>
          </div>
        ) : null}
        <aside className="sp-live-previews">
          <div className="sp-preview-heading">
            <h2>Live previews</h2>
            <span>Updates as your draft changes</span>
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
                  accountLabel: account.displayName ?? account.username ?? "account",
                  data: preview,
                },
              ];
            })}
          />
        </aside>
      </div>
      {validation ? (
        <section className="sp-validation" aria-live="polite">
          <h2>{validation.summary.isValid ? "Ready for publishing" : "Changes needed before publishing"}</h2>
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
          <h2>Publishing results</h2>
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
                {result.platform}: {result.success ? "Published" : (result.message ?? result.error ?? "Failed")}
                {result.postUrl ? (
                  <button onClick={() => void app.openLink({ url: result.postUrl! })}>Open published post</button>
                ) : null}
              </p>
            ),
          )}
        </section>
      ) : null}
      {imageFittingEnabled && manual ? (
        <label>
          Image fitting
          <select
            value={imageFit}
            disabled={working || !statusEditable}
            onChange={(event) => {
              setImageFit(event.target.value as "crop" | "blur" | "");
              setValidation(null);
              setReview(null);
            }}>
            <option value="">Use original images</option>
            <option value="crop">Crop to fit platform requirements</option>
            <option value="blur">Fit with a blurred background</option>
          </select>
        </label>
      ) : null}
      <footer className="sp-editor-footer">
        <div className="sp-actions">
          <button
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
            Check platform rules
          </button>
          <button
            className="sp-primary"
            disabled={working || !statusEditable || !canValidate || content.accountIds.length === 0}
            onClick={() => void act(() => commit("draft"))}>
            {session.status === "scheduled" ? "Move to drafts" : "Save draft"}
          </button>
        </div>
        <div className="sp-actions">
          <button
            disabled={working || !statusEditable || !canValidate || content.accountIds.length === 0}
            onClick={() => setReview("schedule")}>
            Review schedule
          </button>
          <button
            disabled={working || !statusEditable || !canValidate || content.accountIds.length === 0}
            onClick={() => setReview("now")}>
            Review publish now
          </button>
        </div>
      </footer>
      {review ? (
        <section className="sp-publish-review" role="region" aria-label="Review publishing action">
          {review === "schedule" ? (
            <label>
              Publishing time · {timeZone}
              <input
                type="datetime-local"
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
          <h2>{review === "schedule" ? `Schedule for ${localTime.replace("T", " ")} · ${timeZone}` : "Publish now"}</h2>
          <p>
            Send this single post to{" "}
            {variants
              .map((account) => `${account.platform} (${account.displayName ?? account.username ?? "account"})`)
              .join(", ")}
            . Review every preview above before continuing.
          </p>
          <button
            className="sp-primary"
            disabled={working || (review === "schedule" && !localTime)}
            onClick={() => void act(() => commit(review))}>
            {review === "schedule" ? "Confirm schedule" : "Confirm publish now"}
          </button>
          <button disabled={working} onClick={() => setReview(null)}>
            Keep editing
          </button>
        </section>
      ) : null}
    </section>
  );
}
