import Stripe from "stripe";

import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";

import type { PrismaClient } from "@prisma/client";

type BillingUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  stripeCustomerId?: string | null;
};

type StripeCustomerClient = Pick<Stripe.CustomerResource, "create" | "retrieve">;

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

function isDeletedStripeCustomer(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
): customer is Stripe.DeletedCustomer {
  return "deleted" in customer && customer.deleted === true;
}

export function isMissingStripeResourceError(error: unknown, resource?: string): boolean {
  if (!error || typeof error !== "object") return false;

  const stripeError = error as {
    code?: string;
    type?: string;
    raw?: {
      code?: string;
      param?: string;
      type?: string;
    };
    param?: string;
  };

  const code = stripeError.code ?? stripeError.raw?.code;
  const type = stripeError.type ?? stripeError.raw?.type;
  const param = stripeError.param ?? stripeError.raw?.param;

  return (
    code === "resource_missing" &&
    (!type || type === "invalid_request_error" || type === "StripeInvalidRequestError") &&
    (!resource || param === resource)
  );
}

async function createStripeCustomer(
  user: BillingUser,
  customers: StripeCustomerClient = getStripe().customers,
  client: Pick<PrismaClient, "user"> = prisma,
): Promise<string> {
  const customer = await customers.create({
    email: user.email ?? undefined,
    name: user.name ?? undefined,
    metadata: {
      userId: user.id,
    },
  });

  await client.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

export async function getOrCreateStripeCustomer(
  user: BillingUser,
  customers: StripeCustomerClient = getStripe().customers,
  client: Pick<PrismaClient, "user"> = prisma,
): Promise<string> {
  if (user.stripeCustomerId) {
    try {
      const customer = await customers.retrieve(user.stripeCustomerId);
      if (!isDeletedStripeCustomer(customer)) {
        return customer.id;
      }
    } catch (error) {
      if (!isMissingStripeResourceError(error, "customer")) {
        throw error;
      }
    }
  }

  return createStripeCustomer(user, customers, client);
}
