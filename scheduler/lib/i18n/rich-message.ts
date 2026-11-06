import { Fragment, createElement, type ReactNode } from "react";

/** Parse only named component slots. Text and interpolation are always React text nodes. */
export function renderMessage(
  message: string,
  component: (name: string, children: ReactNode[], key: number) => ReactNode,
  values: Record<string, string | number> = {},
  locale = "en",
): ReactNode {
  const interpolate = (text: string) =>
    text.replaceAll(/\{\{\s*(\w+)\s*\}\}/g, (token, name: string) => {
      const value = values[name];
      return value === undefined
        ? token
        : typeof value === "number"
          ? new Intl.NumberFormat(locale).format(value)
          : value;
    });
  const root: { name: string; children: ReactNode[] } = {
    name: "",
    children: [],
  };
  const stack = [root];
  let position = 0;
  let key = 0;
  for (const match of message.matchAll(/<(\/?)(part\d+)>/g)) {
    stack.at(-1)!.children.push(interpolate(message.slice(position, match.index)));
    if (match[1]) {
      const current = stack.pop();
      if (!current || current.name !== match[2] || stack.length === 0) return message;
      stack.at(-1)!.children.push(component(current.name, current.children, key++));
    } else {
      stack.push({ name: match[2], children: [] });
    }
    position = match.index! + match[0].length;
  }
  if (stack.length !== 1) return message;
  root.children.push(interpolate(message.slice(position)));
  return createElement(Fragment, null, ...root.children);
}
