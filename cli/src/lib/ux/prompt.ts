import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import { createColors, type Colors } from "./colors.js";

interface PromptOptions {
  defaultValue?: string;
  required?: boolean;
}

interface SelectOption<T extends string> {
  description?: string;
  group?: string;
  label: string;
  value: T;
}

class SilentWritable extends Writable {
  public muted = false;

  public constructor(private readonly target: NodeJS.WritableStream & { isTTY?: boolean }) {
    super();
  }

  public override _write(
    chunk: string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    if (!this.muted) {
      if (typeof chunk === "string") {
        this.target.write(chunk, encoding);
      } else {
        this.target.write(chunk);
      }
    }

    callback();
  }
}

const BANNER = `
  SimplePost
`;

export class PromptSession {
  public readonly interactive: boolean;
  private readonly colors: Colors;
  private readonly input: NodeJS.ReadableStream & { isTTY?: boolean };
  private readonly output: NodeJS.WritableStream & { columns?: number; isTTY?: boolean };

  public constructor(options?: {
    input?: NodeJS.ReadableStream & { isTTY?: boolean };
    output?: NodeJS.WritableStream & { columns?: number; isTTY?: boolean };
  }) {
    this.input = (options?.input ?? defaultInput) as NodeJS.ReadableStream & { isTTY?: boolean };
    this.output = (options?.output ?? defaultOutput) as NodeJS.WritableStream & { columns?: number; isTTY?: boolean };
    this.interactive = Boolean(this.input.isTTY && this.output.isTTY);
    this.colors = createColors(this.output.isTTY);
  }

  public printBanner(): void {
    if (!this.interactive) return;
    this.log(this.colors.lime(this.colors.bold(BANNER)));
  }

  public log(message: string): void {
    this.output.write(`${message}\n`);
  }

  public async text(message: string, options?: PromptOptions): Promise<string> {
    this.assertInteractive(message);

    while (true) {
      const suffix = options?.defaultValue ? ` [${options.defaultValue}]` : "";
      const answer = (await this.question(`${this.colors.lime(message)}${suffix}: `)).trim();
      if (answer) {
        return answer;
      }

      if (options?.defaultValue !== undefined) {
        return options.defaultValue;
      }

      if (!options?.required) {
        return "";
      }

      this.log("A value is required.");
    }
  }

  public async secret(message: string, options?: { confirm?: boolean }): Promise<string> {
    this.assertInteractive(message);

    while (true) {
      const value = (await this.hiddenQuestion(`${this.colors.lime(message)}: `)).trim();
      if (!value) {
        this.log("A value is required.");
        continue;
      }

      if (!options?.confirm) {
        return value;
      }

      const confirmation = (await this.hiddenQuestion("Confirm password: ")).trim();
      if (value === confirmation) {
        return value;
      }

      this.log("Passwords do not match.");
    }
  }

  public async confirm(message: string, defaultValue = true): Promise<boolean> {
    this.assertInteractive(message);

    const hint = defaultValue ? "[Y/n]" : "[y/N]";
    while (true) {
      const answer = (await this.question(`${this.colors.lime(message)} ${hint}: `)).trim().toLowerCase();
      if (!answer) {
        return defaultValue;
      }

      if (["y", "yes"].includes(answer)) return true;
      if (["n", "no"].includes(answer)) return false;

      this.log("Please answer yes or no.");
    }
  }

  public async select<T extends string>(
    message: string,
    options: Array<SelectOption<T>>,
    defaultValue?: T,
  ): Promise<T> {
    this.assertInteractive(message);

    const defaultIndex =
      defaultValue === undefined ? undefined : options.findIndex((option) => option.value === defaultValue) + 1;

    this.log(this.colors.lime(message));
    this.log("");

    if (defaultIndex && defaultIndex > 0) {
      this.log(`Press Enter to use [${defaultIndex}] ${options[defaultIndex - 1].label}.`);
      this.log("");
    }

    this.renderOptions(options);

    while (true) {
      const promptLabel =
        defaultIndex && defaultIndex > 0 ? `Select an option [${defaultIndex}]: ` : "Select an option: ";
      const answer = (await this.question(promptLabel)).trim();
      if (!answer && defaultValue) {
        return defaultValue;
      }

      const index = Number.parseInt(answer, 10);
      if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
        return options[index - 1].value;
      }

      const exactMatch = options.find((option) => option.value === answer);
      if (exactMatch) {
        return exactMatch.value;
      }

      this.log("Please choose one of the listed options.");
    }
  }

  public async multiSelect<T extends string>(
    message: string,
    options: Array<SelectOption<T>>,
    settings?: {
      defaultValues?: T[];
      minSelections?: number;
    },
  ): Promise<T[]> {
    this.assertInteractive(message);

    const defaultValues = settings?.defaultValues ?? [];
    const defaultIndexList = options
      .map((option, index) => (defaultValues.includes(option.value) ? index + 1 : undefined))
      .filter((value): value is number => value !== undefined);

    this.log(this.colors.lime(message));
    this.log("");
    this.log("Choose one or more options by number or value. Separate multiple choices with commas.");
    if ((settings?.minSelections ?? 0) === 0) {
      this.log('Type "none" to continue without selecting anything.');
    }
    if (defaultIndexList.length > 0) {
      this.log(`Press Enter to keep the current selection [${defaultIndexList.join(", ")}].`);
    }
    this.log("");

    this.renderOptions(options, { selectedValues: new Set(defaultValues) });

    while (true) {
      const promptLabel =
        defaultIndexList.length > 0
          ? `Select options [${defaultIndexList.join(", ")}]: `
          : "Select one or more options: ";
      const answer = (await this.question(promptLabel)).trim();

      if (!answer) {
        if (defaultValues.length > 0) {
          return defaultValues;
        }

        if ((settings?.minSelections ?? 0) === 0) {
          return [];
        }

        this.log("Select at least one option.");
        continue;
      }

      if (answer.toLowerCase() === "none") {
        if ((settings?.minSelections ?? 0) === 0) {
          return [];
        }

        this.log("Select at least one option.");
        continue;
      }

      let parsed: T[];
      try {
        parsed = this.parseMultiSelectAnswer(answer, options);
      } catch (error: unknown) {
        this.log(error instanceof Error ? error.message : String(error));
        continue;
      }

      if (parsed.length < (settings?.minSelections ?? 0)) {
        this.log(`Select at least ${settings?.minSelections} option${settings?.minSelections === 1 ? "" : "s"}.`);
        continue;
      }

      return parsed;
    }
  }

  private logWrapped(message: string, indent: string): void {
    for (const line of this.wrapText(message, indent.length)) {
      this.log(`${indent}${line}`);
    }
  }

  private renderOptions<T extends string>(
    options: Array<SelectOption<T>>,
    settings?: {
      selectedValues?: Set<T>;
    },
  ): void {
    let previousGroup: string | undefined;

    for (const [index, option] of options.entries()) {
      if (option.group && option.group !== previousGroup) {
        if (index > 0) {
          this.log("");
        }

        this.log(option.group);
        previousGroup = option.group;
      }

      const selectedLabel = settings?.selectedValues?.has(option.value) ? " (selected)" : "";
      this.log(`  ${this.colors.lime(`[${index + 1}]`)} ${option.label}${selectedLabel}`);
      if (option.description) {
        this.logWrapped(option.description, "      ");
      }

      if (index < options.length - 1) {
        this.log("");
      }
    }
  }

  private parseMultiSelectAnswer<T extends string>(answer: string, options: Array<SelectOption<T>>): T[] {
    const tokens = answer
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return [];
    }

    if (tokens.length === 1 && tokens[0].toLowerCase() === "all") {
      return options.map((option) => option.value);
    }

    const selected: T[] = [];
    const seen = new Set<T>();

    for (const token of tokens) {
      const option = this.resolveOptionToken(token, options);
      if (!option) {
        throw new Error(`Invalid selection "${token}".`);
      }

      if (!seen.has(option.value)) {
        seen.add(option.value);
        selected.push(option.value);
      }
    }

    return selected;
  }

  private resolveOptionToken<T extends string>(
    token: string,
    options: Array<SelectOption<T>>,
  ): SelectOption<T> | undefined {
    const index = Number.parseInt(token, 10);
    if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
      return options[index - 1];
    }

    return options.find((option) => option.value === token);
  }

  private wrapText(message: string, indentWidth: number): string[] {
    const maxWidth = Math.max(36, (this.output.columns ?? 88) - indentWidth);
    const words = message.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [""];
    }

    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= maxWidth || !currentLine) {
        currentLine = candidate;
        continue;
      }

      lines.push(currentLine);
      currentLine = word;
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  private assertInteractive(action: string): void {
    if (!this.interactive) {
      throw new Error(`Cannot prompt for "${action}" in non-interactive mode.`);
    }
  }

  private async question(prompt: string): Promise<string> {
    const rl = createInterface({ input: this.input, output: this.output });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }

  private async hiddenQuestion(prompt: string): Promise<string> {
    const silentOutput = new SilentWritable(this.output);
    this.output.write(prompt);
    silentOutput.muted = true;

    const rl = createInterface({
      input: this.input,
      output: silentOutput,
      terminal: true,
    });

    try {
      const answer = await rl.question("");
      this.output.write("\n");
      return answer;
    } finally {
      rl.close();
    }
  }
}
