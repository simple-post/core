import type { EXTENSION_TOOL_ANNOTATIONS } from "./tool-annotations";

// Describe user intent separately from the short labels displayed in the UI.
export const EXTENSION_TOOL_DESCRIPTIONS = {
  open_simplepost_workspace:
    "Use this when the user wants a persistent social publishing workspace to browse their calendar, connected destinations, drafts, or recoverable working copies. Opens the sidebar without creating or scheduling a post. For a standalone calendar use show_schedule; for a text schedule use get_schedule. Not for meeting calendars, reminders, or engagement analytics.",
  get_simplepost_workspace:
    "Use this when refreshing data for an already open publishing workspace or inspecting its calendar period, destinations, and recoverable working copies. Does not open UI or create posts. Use open_simplepost_workspace to open the sidebar and get_schedule for a text-only schedule question.",
  open_post_editor:
    "Use this when the user wants to compose or visually edit a social draft or future scheduled post in a persistent editor with platform previews. Supply a known postId to edit an existing post; omit it to open the draft picker/new-post flow. Opening does not save, schedule, or publish. Use show_post_preview for a standalone read-only preview. Cannot edit already-published social content.",
  start_post_editor_session:
    "Use this when an editor needs a new recoverable working copy, optionally from a known draft or future scheduled postId. Creates temporary working state, not a saved post. Reuse an existing session rather than starting another for each edit; read_post_editor_session retrieves it.",
  read_post_editor_session:
    "Use this when reading or recovering a known editor session before proposing, applying, validating, or committing changes. Returns current content and revision; use the actual sessionId from editor context or tool results. Does not change content or publish.",
  update_post_editor_session:
    "Use this when persisting requested working-copy edits or editor autosave using the current expectedRevision. Does not save a post, schedule, or publish it. For an AI writing suggestion the user wants to review first, use propose_post_edit instead; do not silently apply a suggestion.",
  propose_post_edit:
    "Use this when the user asks for writing changes or platform-specific adaptation of the selected editor content for review. Read the current session first and submit a separate patch at its current revision. Keeps existing editor content and saved posts unchanged until the user applies the proposal. Do not create a session for generic copywriting unrelated to a SimplePost draft.",
  commit_post_editor_session:
    "Use this when the user requests saving, scheduling, or publishing the current working copy with its reviewed content, destination accounts, and timing. Use mode=draft to save without publishing, mode=schedule for a future time, or mode=now to publish immediately. Requires the current expectedRevision. Honor any request to wait for confirmation. Do not use for preview-only requests or unapplied suggestions; report conflicts instead of overwriting newer changes.",
  validate_post_editor_session:
    "Use this when checking an existing editor working copy against platform text and media rules before its requested action. Requires the current expectedRevision; optional imageFit can create fitted media. Does not commit, schedule, or publish. Use validate_post for supplied content outside an editor session.",
  read_simplepost_settings:
    "Reads saved publishing preferences and their settings schema for the native settings UI. Does not alter preferences or scheduled posts.",
  update_simplepost_settings:
    "Use this when the user asks to change SimplePost publishing timezone, default destinations, or calendar view. Saves preferences only; changing timezone does not move existing scheduled posts. Use update_scheduled_post to reschedule an actual post, not this tool.",
} satisfies Record<keyof typeof EXTENSION_TOOL_ANNOTATIONS, string>;
