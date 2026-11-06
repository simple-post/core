/** Nonserialized presentation metadata shared by the SDK's bundled entry points. */
const DISPLAY_MESSAGE = Symbol.for("simplepost.authored-display-message");
export type DisplayValues = Readonly<Record<string, string | number | DisplayMessage>>;
export type DisplayMessage = Readonly<{ source: string; values: DisplayValues }>;

export function displayMessage(source: string, values: DisplayValues = {}): DisplayMessage {
  return { source, values };
}

/** The original message remains canonical; consumers translate only at a display boundary. */
export function describeDisplayMessage<const T extends object>(
  target: T,
  source: string,
  values: DisplayValues = {},
): T {
  Object.defineProperty(target, DISPLAY_MESSAGE, { value: displayMessage(source, values), configurable: true });
  return target;
}

export function getDisplayMessage(value: unknown): DisplayMessage | undefined {
  if (!value || typeof value !== "object") return undefined;
  return (value as { [DISPLAY_MESSAGE]?: DisplayMessage })[DISPLAY_MESSAGE];
}

export function copyDisplayMessage<const T extends object>(source: unknown, target: T): T {
  const message = getDisplayMessage(source);
  return message ? describeDisplayMessage(target, message.source, message.values) : target;
}

export function canonicalDisplayMessage(message: string | DisplayMessage): string {
  if (typeof message === "string") return message;
  return message.source.replaceAll(
    /{{(\w+)(,\s*number)?}}/g,
    (token: string, name: string, number: string | undefined) => {
      const value = message.values[name];
      if (value === undefined) return token;
      if (typeof value === "object") return canonicalDisplayMessage(value);
      return number && typeof value === "number" ? new Intl.NumberFormat("en").format(value) : String(value);
    },
  );
}

export function withDisplayMessage<const T extends object>(
  target: T,
  message: string | DisplayMessage,
): T & { message: string } {
  const result = { ...target, message: canonicalDisplayMessage(message) };
  return typeof message === "string" ? result : describeDisplayMessage(result, message.source, message.values);
}
