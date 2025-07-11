import { LogLevel } from "../types/post";

export class Logger {
  private readonly prefix: string;
  private readonly logLevel: LogLevel;

  constructor(prefix: string, logLevel: LogLevel = LogLevel.NONE) {
    this.prefix = prefix;
    this.logLevel = logLevel;
  }

  private getMessageWithPrefix(message: string) {
    return `[${this.prefix}] ${message}`;
  }

  info(message: string) {
    if (this.logLevel === LogLevel.INFO) {
      console.log(this.getMessageWithPrefix(message));
    }
  }

  warn(message: string) {
    if (this.logLevel === LogLevel.ERROR || this.logLevel === LogLevel.WARN) {
      console.warn(this.getMessageWithPrefix(message));
    }
  }

  error(message: string) {
    if (this.logLevel !== LogLevel.NONE) {
      console.error(this.getMessageWithPrefix(message));
    }
  }
}
