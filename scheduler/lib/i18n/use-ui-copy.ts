"use client";

import { useCallback } from "react";

import { useUiTranslation } from "./client";

import type { MessageKey, MessageValues } from "./translate";

/** Authored interface copy only. Never pass user content through translation. */
export function useUiCopy() {
  const { locale, t } = useUiTranslation();
  const copy = useCallback((source: string, values?: MessageValues): string => t(source as MessageKey, values), [t]);
  return { locale, copy };
}
