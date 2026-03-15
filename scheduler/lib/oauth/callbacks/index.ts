import type { NextResponse } from "next/server";

import type { CallbackContext } from "@/lib/oauth/types";

import { handleBlueskyCallback } from "./bluesky";
import { handleFacebookCallback } from "./facebook";
import { handleGenericCallback } from "./generic";
import { handleInstagramCallback } from "./instagram";

const platformHandlers: Record<string, (ctx: CallbackContext) => Promise<NextResponse>> = {
  bluesky: handleBlueskyCallback,
  instagram: handleInstagramCallback,
  facebook: handleFacebookCallback,
};

export async function handlePlatformCallback(ctx: CallbackContext): Promise<NextResponse> {
  const handler = platformHandlers[ctx.platform] ?? handleGenericCallback;
  return handler(ctx);
}
