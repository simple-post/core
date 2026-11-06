"use client";

import { cloneElement, type ReactElement, type ReactNode } from "react";

import { renderMessage } from "@/lib/i18n/rich-message";
import { useUiCopy } from "@/lib/i18n/use-ui-copy";

/** Complete authored sentences can reorder safe React slots; no translated HTML is inserted. */
export function UiCopy({
  source,
  components = {},
  values,
}: {
  source: string;
  components?: Record<string, ReactElement<{ children?: ReactNode }>>;
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
      return element
        ? element.type === "br"
          ? cloneElement(element, { key })
          : cloneElement(element, { key }, opaqueSlots.has(name) ? element.props.children : children)
        : children;
    },
    values,
    locale,
  );
}
