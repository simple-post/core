import type { editorContentSchema } from "@/lib/mcp/extensions/contracts";
import type { loadWorkspace, readEditor } from "@/lib/mcp/extensions/workspace";

import type { z } from "zod";

export type WorkspaceData = Awaited<ReturnType<typeof loadWorkspace>> & {
  accountsUrl: string;
  canWrite: boolean;
  canValidate: boolean;
  imageFittingEnabled: boolean;
  requestedPostId?: string | null;
};
export type EditorData = Awaited<ReturnType<typeof readEditor>>;
export type EditorContent = z.infer<typeof editorContentSchema>;
export type Validation = {
  summary: { isValid: boolean; errors: Array<{ message: string }>; warnings: Array<{ message: string }> };
  accounts: Array<{ accountId: string; errors: Array<{ message: string }>; warnings: Array<{ message: string }> }>;
};
