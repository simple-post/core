import type { SourceCopy } from "./source-copy";

/** This receives the authored OpenAPI document, never request or response payloads. */
export function openApiDisplay<T>(value: T, copy: SourceCopy): T {
  if (Array.isArray(value)) return value.map((item) => openApiDisplay(item, copy)) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => {
      if (["example", "examples", "enum", "const", "default"].includes(key)) return [key, child];
      if (["title", "description", "summary"].includes(key) && typeof child === "string") return [key, copy(child)];
      return [key, openApiDisplay(child, copy)];
    }),
  ) as T;
}
