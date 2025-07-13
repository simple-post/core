import { LogLevel } from "../types/post";

export class Logger {
  private readonly prefix: string;
  private readonly logLevel: LogLevel;

  constructor(prefix: string, logLevel: LogLevel = "none") {
    this.prefix = prefix;
    this.logLevel = logLevel;
  }

  private getMessageWithPrefix(message: string | Error) {
    return `[${this.prefix}] ${message instanceof Error ? message.message : message}`;
  }

  info(message: string | Error) {
    if (this.logLevel === "info") {
      console.log(this.getMessageWithPrefix(message));
    }
  }

  warn(message: string | Error) {
    if (this.logLevel === "info" || this.logLevel === "warn") {
      console.warn(this.getMessageWithPrefix(message));
    }
  }

  error(message: string | Error) {
    if (this.logLevel !== "none") {
      console.error(this.getMessageWithPrefix(message));
    }
  }
}
