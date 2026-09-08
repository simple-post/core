/** Telegram's HTML subset is deliberately smaller than browser HTML. */
const tags = new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "ins",
  "s",
  "strike",
  "del",
  "span",
  "tg-spoiler",
  "a",
  "tg-emoji",
  "code",
  "pre",
  "blockquote",
  "tg-time",
]);
const entities: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"' };
export function telegramText(text: string, mode?: string): { text: string; error?: string; warning?: string } {
  if (!mode) return { text };
  if (mode !== "HTML") {
    // Do not pretend a partial Markdown parser proves validity. This mode needs provider parsing.
    return {
      text,
      warning:
        "Telegram Markdown formatting could not be fully verified. Use HTML or plain-text captions for local entity validation; Telegram may reject unsupported or unbalanced Markdown.",
    };
  }
  const stack: string[] = [];
  let output = "";
  const invalid = () => ({
    text: output,
    error:
      "Telegram HTML is invalid or unsupported. Balance formatting tags, escape literal <, > and & as &lt;, &gt; and &amp;, and use Telegram-supported tags and attributes.",
  });
  for (let index = 0; index < text.length; ) {
    switch (text[index]) {
      case "<": {
        const token = /^<(\/)?([a-z-]+)((?:\s+[\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*>/i.exec(text.slice(index));
        if (!token) return invalid();
        const [, closing, rawTag, attributes] = token;
        const tag = rawTag.toLowerCase();
        if (!tags.has(tag)) return invalid();
        if (closing) {
          if (attributes.trim() || stack.pop() !== tag) return invalid();
        } else {
          const allowed: Record<string, RegExp> = {
            a: /^\s+href\s*=\s*(?:"[^"<>]+"|'[^'<>]+')\s*$/i,
            span: /^\s+class\s*=\s*(?:"tg-spoiler"|'tg-spoiler')\s*$/i,
            "tg-emoji": /^\s+emoji-id\s*=\s*(?:"\d+"|'\d+')\s*$/i,
            code: /^(?:\s+class\s*=\s*(?:"language-[\w+-]+"|'language-[\w+-]+'))?\s*$/i,
            blockquote: /^(?:\s+expandable)?\s*$/i,
            "tg-time": /^\s+unix\s*=\s*(?:"\d+"|'\d+')(?:\s+format\s*=\s*(?:"[^"]+"|'[^']+'))?\s*$/i,
          };
          if (allowed[tag] ? !allowed[tag].test(attributes) : !!attributes.trim()) return invalid();
          if ((tag === "pre" || tag === "code") && stack.some((parent) => parent !== "pre")) return invalid();
          stack.push(tag);
        }
        index += token[0].length;

        break;
      }
      case "&": {
        const entity = /^&(#(?:x|X)[\da-fA-F]+|#\d+|lt|gt|amp|quot);/.exec(text.slice(index));
        if (!entity) return invalid();
        const key = entity[1];
        const point = key.startsWith("#")
          ? Number.parseInt(key.slice(/^#x/i.test(key) ? 2 : 1), /^#x/i.test(key) ? 16 : 10)
          : undefined;
        if (
          point !== undefined &&
          (!Number.isFinite(point) || point > 1_114_111 || point === 0 || (point >= 55_296 && point <= 57_343))
        )
          return invalid();
        output += point === undefined ? entities[key] : String.fromCodePoint(point);
        index += entity[0].length;

        break;
      }
      case ">": {
        return invalid();
      }
      default: {
        output += text[index++];
      }
    }
  }
  return stack.length > 0 ? invalid() : { text: output };
}
