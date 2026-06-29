import Stripe from "stripe";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

function getRequired(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const globalForStripe = globalThis as unknown as {
  stripe: Stripe | undefined;
};

export function getStripe(): Stripe {
  if (!globalForStripe.stripe) {
    globalForStripe.stripe = new Stripe(getRequired("STRIPE_SECRET_KEY"));
  }

  return globalForStripe.stripe;
}

export function getStripeWebhookSecret(): string {
  return getRequired("STRIPE_WEBHOOK_SECRET");
}

export function getAppUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
}

export async function getOrCreateStripeCustomer(user: {
  id: string;
  email?: string | null;
  name?: string | null;
  stripeCustomerId?: string | null;
}): Promise<string> {
  if (user.stripeCustomerId) {
    return user.stripeCustomerId;
  }

  const customer = await getStripe().customers.create({
    email: user.email ?? undefined,
    name: user.name ?? undefined,
    metadata: {
      userId: user.id,
    },
  });

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}
