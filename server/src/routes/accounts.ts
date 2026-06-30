import { Router } from "express";

import { getAccounts } from "../config/accounts.js";
import { handleApiError } from "../utils/errors.js";

import type { Request, Response } from "express";

const router = Router();

router.get("/", (_req: Request, res: Response): void => {
  try {
    const accounts = getAccounts().map((account) => ({
      id: account.id,
      platform: account.rawPlatform,
      label: account.label,
      username: account.username,
      platformAccountId: account.platformAccountId,
      profilePicture: account.profilePicture,
    }));
    res.json({ accounts });
  } catch (error) {
    handleApiError(error, res);
  }
});

export default router;
