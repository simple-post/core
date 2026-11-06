import { useCallback, useState } from "react";

import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";

import { useHostLocale } from "./use-host-locale";
import { widgetFallback } from "./widget-locale";

import type { SourceCopy } from "../lib/i18n/source-copy";

type ChatGptWindow = Window & {
  openai?: {
    toolOutput?: unknown;
  };
};

function initialToolOutput<T>(): T | null {
  if (typeof window === "undefined") return null;
  return ((window as ChatGptWindow).openai?.toolOutput as T | undefined) ?? null;
}

export function useMcpToolData<T>(name: string) {
  const [data, setData] = useState<T | null>(() => initialToolOutput<T>());
  const [toolError, setToolError] = useState<string | null>(null);

  const onAppCreated = useCallback(
    (createdApp: Parameters<NonNullable<Parameters<typeof useApp>[0]["onAppCreated"]>>[0]) => {
      createdApp.ontoolresult = (result) => {
        if (result.isError) {
          const message = result.content.find((item) => item.type === "text");
          setToolError(message?.type === "text" ? message.text : "The tool call failed.");
          return;
        }
        setToolError(null);
        setData(result.structuredContent as T);
      };
    },
    [],
  );

  const state = useApp({
    appInfo: { name, version: "1.0.0" },
    capabilities: {},
    onAppCreated,
  });
  useHostStyles(state.app, state.app?.getHostContext());
  const locale = useHostLocale(state.app);

  return {
    ...state,
    ...locale,
    data,
    setData,
    toolError: widgetFallback(toolError, locale.t as SourceCopy),
    setToolError,
  };
}
