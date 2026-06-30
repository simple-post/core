import { Router } from "express";

import { createServerOpenApiDocument } from "../openapi/document.js";

import type { Request, Response } from "express";

const router = Router();

router.get("/", (_req: Request, res: Response): void => {
  res.json(createServerOpenApiDocument());
});

export default router;
