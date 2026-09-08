/** Telegram formatting grammar, not CommonMark. See https://core.telegram.org/bots/api#formatting-options. */
export function telegramMarkdown(source: string, legacy = false): { text: string; error?: string } {
  let text = "";
  let index = 0;
  let quote = false;
  const stack: Array<{ token: string; start: number }> = [];
  const invalid = (reason: string) => ({
    text,
    error: `Telegram ${legacy ? "Markdown" : "MarkdownV2"}: ${reason}. Escape literal formatting characters with a backslash or correct the markup.`,
  });
  const fenceStart = () => {
    // Optional language identifier and one opening newline are not visible text.
    const language = /^[^\s`]+(?=\s)/.exec(source.slice(index));
    if (language) index += language[0].length;
    const newline = /^(?:\r\n|\n\r|\r|\n)/.exec(source.slice(index));
    if (newline) index += newline[0].length;
  };
  const linkEnd = (custom: boolean): boolean => {
    if (source[index] !== "(") return !custom;
    index++;
    let url = "";
    while (index < source.length && source[index] !== ")") {
      if (!legacy && source[index] === "\\" && source[index + 1] && source.codePointAt(index + 1)! <= 126) index++;
      url += source[index++];
    }
    if (source[index++] !== ")") return false;
    return !custom || /^tg:\/\/(?:emoji\?id=\d+|time\?unix=\d+(?:&format=[A-Za-z]+)?)$/.test(url);
  };
  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];
    const top = stack.at(-1);
    if (char === "\\" && next && (legacy ? "_*`[".includes(next) : source.codePointAt(index + 1)! <= 126)) {
      text += next;
      index += 2;
      continue;
    }
    if (legacy) {
      if (!"_*`[".includes(char)) {
        text += char;
        index++;
        continue;
      }
      const fenced = source.startsWith("```", index);
      let endToken = char === "[" ? "]" : char;
      if (fenced) endToken = "```";
      index += fenced ? 3 : 1;
      if (fenced) fenceStart();
      const end = source.indexOf(endToken, index);
      if (end === -1) return invalid(`unclosed ${char} entity`);
      text += source.slice(index, end);
      index = end + endToken.length;
      if (char === "[" && !linkEnd(false)) return invalid("unclosed link URL");
      continue;
    }
    if (top?.token === "`" || top?.token === "```") {
      if (source.startsWith(top.token, index)) {
        index += top.token.length;
        stack.pop();
      } else if (char === "`") return invalid("escape backticks inside a code block");
      else {
        text += char;
        index++;
      }
      continue;
    }
    if (char === "\n") {
      if (quote && next !== ">") {
        if (stack.length === 1 && top?.token === "||" && top.start === index - 2) stack.pop();
        if (stack.length > 0) return invalid("close formatting before the end of a block quote");
        quote = false;
      }
      text += char;
      index++;
      continue;
    }
    if (char === ">") {
      if (text.length > 0 && !text.endsWith("\n")) return invalid("escape > outside the start of a block quote");
      quote = true;
      index++;
      continue;
    }
    if (char === "]") {
      if (top?.token !== "[" && top?.token !== "![") return invalid("unexpected ]");
      stack.pop();
      index++;
      if (!linkEnd(top.token === "![")) return invalid("invalid or unclosed link URL");
      continue;
    }
    let token: string | undefined;
    if (source.startsWith("```", index)) token = "```";
    else if (source.startsWith("__", index)) token = "__";
    else if (source.startsWith("||", index)) token = "||";
    else if (source.startsWith("![", index)) token = "![";
    else if ("_*~`[".includes(char)) token = char;
    if (token) {
      if (top?.token === token) stack.pop();
      else stack.push({ token, start: index });
      index += token.length;
      if (token === "```") fenceStart();
      continue;
    }
    if ("()#+-=|{}.!".includes(char)) return invalid(`unescaped ${char}`);
    text += char;
    index++;
  }
  const top = stack.at(-1);
  if (quote && stack.length === 1 && top?.token === "||" && top.start === source.length - 2) stack.pop();
  return stack.length > 0 ? invalid(`unclosed ${stack.at(-1)!.token} entity`) : { text };
}
