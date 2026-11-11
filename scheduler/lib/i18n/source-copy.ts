import type { MessageValues } from "./translate";

export type SourceCopy = (source: string, values?: MessageValues) => string;
/** Pure fallback for reusable helpers; UI callers supply their request/provider translator. */
export const sourceCopy: SourceCopy = (source, values = {}) =>
  source.replaceAll(/\{\{\s*(\w+)(?:,\s*number)?\s*\}\}/g, (token, name: string) =>
    values[name] === undefined ? token : String(values[name]),
  );
