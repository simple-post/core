import { Router } from "express";

import type { Request, Response } from "express";

const router = Router();

router.get("/", (_req: Request, res: Response): void => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || "unknown",
  });
});

export default router;
