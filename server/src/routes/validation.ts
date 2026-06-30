import { validationRequestSchema } from "@simple-post/sdk";
import { Router } from "express";

import { validatePostForAccounts } from "../services/validation.js";
import { handleApiError, ValidationError } from "../utils/errors.js";

import type { Request, Response } from "express";

const router = Router();

router.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = validationRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw new ValidationError(parseResult.error.issues);
    }

    const validated = parseResult.data;
    const validation = validatePostForAccounts({
      message: validated.message,
      media: validated.media,
      accountIds: validated.accountIds,
      accountOverrides: validated.accountOverrides,
      thread: validated.thread,
    });

    res.json(validation);
  } catch (error) {
    handleApiError(error, res);
  }
});

export default router;
