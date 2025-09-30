import type { Request, Response, NextFunction } from "express";

export interface AuthenticatedRequest extends Request {
  apiKey: string;
}

export function createAuthMiddleware(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const providedKey = req.headers["x-api-key"];

    if (!providedKey) {
      res.status(401).json({
        error: "Authentication required",
        message: "API key must be provided in 'x-api-key' header",
      });
      return;
    }

    if (providedKey !== apiKey) {
      res.status(401).json({
        error: "Invalid API key",
        message: "The provided API key is not valid",
      });
      return;
    }

    (req as AuthenticatedRequest).apiKey = providedKey;
    next();
  };
}
