"use client";

import { cloneElement, createElement, Fragment, isValidElement, type ReactNode } from "react";

import { renderMessage } from "@/lib/i18n/rich-message";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

/** Complete authored sentences can reorder safe React slots; no translated HTML is inserted. */
export function UiCopy({
  source,
  components = {},
  values,
}: {
  source: string;
  components?: Record<string, ReactNode>;
  values?: Record<string, string | number>;
}) {
  const { copy, locale } = useUiCopy();
  const placeholders: Record<string, string | number> = Object.fromEntries(
    [...source.matchAll(/\{\{\s*(\w+)(?:,\s*number)?\s*\}\}/g)].map((match) => [match[1], match[0]]),
  );
  // Only numeric count enters i18next before rendering, for plural selection.
  // User strings remain opaque until React text-node interpolation.
  if (typeof values?.count === "number") placeholders.count = values.count;
  const opaqueSlots = new Set([...source.matchAll(/<(part\d+)><\/\1>/g)].map((match) => match[1]));
  return renderMessage(
    copy(source, placeholders),
    (name, children, key) => {
      const element = components[name];
      // RSC can serialize an opaque Fragment as its scalar children. Keep the
      // slot intact instead of reading element.props or reconstructing user text.
      if (opaqueSlots.has(name)) return createElement(Fragment, { key }, element);
      if (!isValidElement(element)) return children;
      return element.type === "br" ? cloneElement(element, { key }) : cloneElement(element, { key }, children);
    },
    values,
    locale,
  );
}
