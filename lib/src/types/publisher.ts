import { PostErrorType, PostResult } from ".";
import { Content, PostOptions } from "./post";

export class PostError extends Error {
  public errorType: PostErrorType;
  public details?: any;

  constructor(errorType: PostErrorType, message: string, details?: any) {
    super(message);
    this.name = "PostError";
    this.errorType = errorType;
    this.message = message;
    this.details = details;
  }
}

export abstract class Publisher {
  abstract post(content: Content, options: PostOptions): Promise<PostResult>;
}
