import { readFileSync } from "node:fs";
import path from "node:path";

import { MCP_TOOL_ANNOTATIONS, MCP_TOOL_HINT_KEYS, type McpToolHintKey } from "@/lib/mcp/tool-annotations";

const JUSTIFICATION_KEYS: Record<McpToolHintKey, string> = {
  readOnlyHint: "read_only_justification",
  destructiveHint: "destructive_justification",
  idempotentHint: "idempotent_justification",
  openWorldHint: "open_world_justification",
};

type SubmissionTool = {
  annotations?: Record<string, unknown>;
  justifications?: Record<string, unknown>;
};

type SubmissionCase = {
  user_prompt: string;
  file_attachment_urls: string[] | null;
  tools_triggered: string | null;
};

type Submission = {
  tools: Record<string, SubmissionTool>;
  test_cases: SubmissionCase[];
  negative_test_cases: SubmissionCase[];
};

function readSubmission(): Submission {
  const submissionPath = path.resolve(__dirname, "../../../chatgpt-app-submission.json");
  return JSON.parse(readFileSync(submissionPath, "utf8")) as Submission;
}

function parseTriggeredTools(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}

describe("ChatGPT app submission metadata", () => {
  const submission = readSubmission();
  const knownToolNames = Object.keys(MCP_TOOL_ANNOTATIONS) as Array<keyof typeof MCP_TOOL_ANNOTATIONS>;
  const knownToolNameStrings = knownToolNames.map(String);

  it("keeps submitted tool annotations in sync with the live MCP descriptors", () => {
    expect(Object.keys(submission.tools).sort()).toEqual([...knownToolNames].sort());

    for (const toolName of knownToolNames) {
      const submittedTool = submission.tools[toolName];
      expect(submittedTool).toBeDefined();

      for (const hintKey of MCP_TOOL_HINT_KEYS) {
        expect(submittedTool.annotations?.[hintKey]).toBe(MCP_TOOL_ANNOTATIONS[toolName][hintKey]);
        expect(typeof submittedTool.annotations?.[hintKey]).toBe("boolean");

        const justification = submittedTool.justifications?.[JUSTIFICATION_KEYS[hintKey]];
        expect(typeof justification).toBe("string");
        expect((justification as string).length).toBeGreaterThan(24);
      }
    }
  });

  it("keeps submitted test cases self-contained and tied to registered tools", () => {
    expect(submission.test_cases).toHaveLength(6);

    for (const testCase of submission.test_cases) {
      const triggeredTools = parseTriggeredTools(testCase.tools_triggered);
      expect(triggeredTools.length).toBeGreaterThan(0);
      for (const tool of triggeredTools) {
        expect(knownToolNameStrings).toContain(tool);
      }

      if (triggeredTools.includes("update_scheduled_post") || triggeredTools.includes("discard_scheduled_post")) {
        expect(triggeredTools).toContain("create_post");
        expect(testCase.user_prompt).not.toMatch(/post_123/i);
      }
    }

    const uploadCase = submission.test_cases.find((testCase) =>
      parseTriggeredTools(testCase.tools_triggered).includes("upload_media"),
    );
    if (uploadCase) {
      expect(uploadCase.file_attachment_urls?.length).toBeGreaterThan(0);
    }

    expect(submission.negative_test_cases).toHaveLength(3);

    for (const testCase of submission.negative_test_cases) {
      expect(testCase.tools_triggered).toBeNull();
    }
  });
});
