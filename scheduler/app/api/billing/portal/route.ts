import { type NextRequest, NextResponse } from "next/server";

import { z } from "zod";

import { getAppUrl, getStripe } from "@/lib/billing/stripe";
import { requireBrowserSession } from "@/lib/middleware/auth";
import { prisma } from "@/lib/prisma";
import { BadRequestError, handleApiError } from "@/lib/utils/errors";

export const dynamic = "force-dynamic";

const portalSchema = z.object({
  purpose: z.enum(["manage", "invoices"]).optional(),
});

async function readJsonBody(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireBrowserSession(req);
    const parsed = portalSchema.safeParse(await readJsonBody(req));
    const purpose = parsed.success ? (parsed.data.purpose ?? "manage") : "manage";
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        stripeCustomerId: true,
        subscription: {
          select: {
            stripeCustomerId: true,
          },
        },
      },
    });

    const customerId = user?.stripeCustomerId ?? user?.subscription?.stripeCustomerId;
    if (!customerId) {
      throw new BadRequestError("No Stripe customer found for this account");
    }

    const portalSession = await getStripe().billingPortal.sessions.create({
      ...(process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID
        ? { configuration: process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID }
        : {}),
      customer: customerId,
      return_url: `${getAppUrl()}/billing${purpose === "invoices" ? "?portal=invoices" : ""}`,
    });

    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    return handleApiError(error);
  }
}
