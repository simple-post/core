import { useCallback, useEffect, useState } from "react";

import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";

import type { App } from "@modelcontextprotocol/ext-apps";

export type WidgetState = { sessionId?: string; content?: unknown; revision?: number };
type OpenAIWindow = Window & {
  openai?: { toolOutput?: unknown; widgetState?: WidgetState; setWidgetState?: (state: WidgetState) => void };
};
export function restoreEditorHint() {
  return (window as OpenAIWindow).openai?.widgetState;
}
export function keepEditorHint(state: WidgetState) {
  (window as OpenAIWindow).openai?.setWidgetState?.(state);
}

export async function callTool<T>(app: App, name: string, arguments_: Record<string, unknown> = {}): Promise<T> {
  const result = await app.callServerTool({ name, arguments: arguments_ });
  if (result.isError || !result.structuredContent) {
    const item = result.content.find((content) => content.type === "text");
    throw new Error(
      item?.type === "text" ? item.text.split("\nSIMPLEPOST_ERROR")[0] : "The action could not be completed.",
    );
  }
  return result.structuredContent as T;
}

export function isWorkspaceLaunch(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return (
    (data.kind === "workspace" || data.kind === "editor_launch") &&
    Array.isArray(data.accounts) &&
    !!data.preferences &&
    !!data.schedule &&
    !!data.posts &&
    typeof data.accountsUrl === "string"
  );
}

export function useExtensionHost<T>() {
  const [launch, setLaunch] = useState<T | null>(() => {
    const output = (window as OpenAIWindow).openai?.toolOutput;
    return isWorkspaceLaunch(output) ? (output as T) : null;
  });
  const [toolError, setToolError] = useState<string | null>(null);
  const [incoming, setIncoming] = useState<Record<string, unknown> | null>(null);
  const onAppCreated = useCallback((app: App) => {
    app.ontoolresult = (result) => {
      if (result.isError) {
        const item = result.content.find((content) => content.type === "text");
        setToolError(
          item?.type === "text"
            ? item.text.split("\nSIMPLEPOST_ERROR")[0]
            : "The publishing workspace could not be opened.",
        );
        return;
      }
      if (!result.structuredContent) return;
      const data = result.structuredContent as Record<string, unknown>;
      if (isWorkspaceLaunch(data)) {
        setToolError(null);
        setLaunch(data as T);
      } else if (data.kind === "workspace" || data.kind === "editor_launch") {
        setToolError("The publishing workspace returned incomplete data. Please try again.");
      } else setIncoming(data);
    };
  }, []);
  useEffect(() => {
    // Compatibility hosts may deliver toolOutput after React mounts instead of
    // sending the standard tool-result notification. Never treat unrelated or
    // empty tool output as a usable workspace.
    const applyOutput = (output: unknown) => {
      if (isWorkspaceLaunch(output)) {
        setToolError(null);
        setLaunch(output as T);
      }
    };
    const readOutput = (event: Event) => {
      const globals = (event as CustomEvent<{ globals?: { toolOutput?: unknown } }>).detail?.globals;
      if (globals && Object.hasOwn(globals, "toolOutput")) applyOutput(globals.toolOutput);
    };
    applyOutput((window as OpenAIWindow).openai?.toolOutput);
    window.addEventListener("openai:set_globals", readOutput);
    return () => window.removeEventListener("openai:set_globals", readOutput);
  }, []);
  const host = useApp({
    appInfo: { name: "SimplePost workspace", version: "1.1.0" },
    capabilities: { availableDisplayModes: ["fullscreen"] },
    onAppCreated,
  });
  useHostStyles(host.app, host.app?.getHostContext());
  return { ...host, launch, setLaunch, incoming, toolError, setToolError };
}

export async function attachSelection(app: App, selected: Record<string, unknown> | null) {
  const capabilities = app.getHostCapabilities()?.updateModelContext;
  if (!capabilities) return false;
  await app.updateModelContext(
    selected
      ? {
          content: [{ type: "text", text: `SimplePost selection: ${JSON.stringify(selected)}` }],
          ...(capabilities.structuredContent ? { structuredContent: selected } : {}),
        }
      : { content: [], ...(capabilities.structuredContent ? { structuredContent: {} } : {}) },
  );
  return true;
}
export async function askChat(app: App, prompt: string, selection: Record<string, unknown>) {
  await attachSelection(app, selection);
  if (!app.getHostCapabilities()?.message)
    throw new Error(
      "This host cannot send a chat request. Copy your request and selected post ID into the conversation.",
    );
  await app.sendMessage({
    role: "user",
    content: [{ type: "text", text: `${prompt}\n\nSelected SimplePost context: ${JSON.stringify(selection)}` }],
  });
}
