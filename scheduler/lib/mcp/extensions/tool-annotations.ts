import type { ToolAnnotations } from "@modelcontextprotocol/server";

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true };
const scratchWrite = { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false };

export const EXTENSION_TOOL_ANNOTATIONS = {
  open_simplepost_workspace: readOnly,
  open_post_editor: readOnly,
  get_simplepost_workspace: readOnly,
  start_post_editor_session: scratchWrite,
  read_post_editor_session: readOnly,
  // Replaces working-copy content and clears its proposal without retaining undo history.
  update_post_editor_session: { ...scratchWrite, destructiveHint: true },
  propose_post_edit: scratchWrite,
  commit_post_editor_session: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: true },
  validate_post_editor_session: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
    idempotentHint: false,
  },
  read_simplepost_settings: readOnly,
  update_simplepost_settings: scratchWrite,
} satisfies Record<string, ToolAnnotations>;
