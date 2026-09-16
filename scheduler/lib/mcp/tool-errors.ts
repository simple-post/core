import { ApiError } from "@/lib/utils/errors";

export type McpErrorStage =
  | "tool_input"
  | "source_download"
  | "media_validation"
  | "storage_upload"
  | "billing"
  | "tool_execution";

export type McpErrorRecovery = "retry_same" | "retry_with_url_or_reattach" | "reattach" | "replace_media" | "stop";

export interface McpErrorDiagnostic {
  code: string;
  stage: McpErrorStage;
  recovery: McpErrorRecovery;
  maxAutomaticRetries: number;
  message: string;
}

export const MCP_ERROR_INSTRUCTIONS =
  "Tool failures include a machine-readable SIMPLEPOST_ERROR object with code, stage, recovery, maxAutomaticRetries, and supportId. Follow recovery exactly: retry the same call only for retry_same, and never more than maxAutomaticRetries; for retry_with_url_or_reattach, use an already available public URL once or ask the user to reattach; for reattach, replace_media, or stop, do not automatically repeat the failed call. Include supportId when reporting an unresolved failure.";

export class McpToolError extends ApiError {
  readonly stage: McpErrorStage;
  readonly recovery: McpErrorRecovery;
  readonly maxAutomaticRetries: number;

  constructor(options: McpErrorDiagnostic & { statusCode?: number }) {
    super(options.message, options.statusCode ?? 400, options.code);
    this.name = "McpToolError";
    this.stage = options.stage;
    this.recovery = options.recovery;
    this.maxAutomaticRetries = options.maxAutomaticRetries;
  }
}

export function toMcpErrorDiagnostic(error: unknown): McpErrorDiagnostic {
  if (error instanceof McpToolError) {
    return {
      code: error.code ?? "MCP_TOOL_FAILED",
      stage: error.stage,
      recovery: error.recovery,
      maxAutomaticRetries: error.maxAutomaticRetries,
      message: error.message,
    };
  }

  const billingDenied = error instanceof ApiError && Boolean(error.logContext);
  const message = error instanceof Error ? error.message : String(error);
  return {
    code: error instanceof ApiError && error.code ? error.code : "MCP_TOOL_FAILED",
    stage: billingDenied ? "billing" : "tool_execution",
    recovery: "stop",
    maxAutomaticRetries: 0,
    message:
      message + (billingDenied ? " Do not retry until the user changes their plan or allowance in SimplePost." : ""),
  };
}
