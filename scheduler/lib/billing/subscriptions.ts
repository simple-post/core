import { Prisma } from "@prisma/client";

import {
  ACTIVE_SUBSCRIPTION_STATUSES,
  getPlanByKey,
  getPlanByStripePriceId,
  type BillingPlan,
} from "@/lib/billing/plans";
import { getStripe } from "@/lib/billing/stripe";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { ForbiddenError, PaymentRequiredError } from "@/lib/utils/errors";

import type { ComplimentaryAccess, PrismaClient, UserSubscription } from "@prisma/client";
import type Stripe from "stripe";

type PrismaTransactionClient = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type BillingClient = PrismaClient | PrismaTransactionClient;

/**
 * Serialize quota-sensitive writes for one user. Call this inside the same
 * database transaction as the count and write it protects.
 */
export async function lockUserForQuota(client: Prisma.TransactionClient, userId: string): Promise<void> {
  await client.$queryRaw(Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${userId} FOR UPDATE`);
}

export type SubscriptionFeature = "apiAccess" | "cliAccess";

export interface BillingUsage {
  connectedAccounts: number;
  postsThisPeriod: number;
}

export interface BillingStatus {
  active: boolean;
  accessType: "stripe" | "complimentary" | "self_hosted" | null;
  plan: BillingPlan | null;
  subscription: {
    status: string;
    planKey: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripePriceId: string | null;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    trialEndsAt: string | null;
  } | null;
  complimentaryAccess: {
    planKey: string;
    startsAt: string;
    expiresAt: string;
    source: string;
  } | null;
  usage: BillingUsage;
}

function toDate(timestamp: number | null | undefined): Date | null {
  return timestamp ? new Date(timestamp * 1000) : null;
}

function toISOString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function getStripeObjectId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function getSubscriptionItem(subscription: Stripe.Subscription): Stripe.SubscriptionItem | null {
  return subscription.items.data[0] ?? null;
}

function getSubscriptionPrice(subscription: Stripe.Subscription): {
  priceId: string | null;
  productId: string | null;
} {
  const price = getSubscriptionItem(subscription)?.price;
  if (!price) {
    return { priceId: null, productId: null };
  }

  const product = price.product;
  const productId = typeof product === "string" ? product : product && "id" in product ? product.id : null;

  return {
    priceId: price.id,
    productId,
  };
}

function getSubscriptionPeriod(subscription: Stripe.Subscription): {
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
} {
  const item = getSubscriptionItem(subscription);
  return {
    currentPeriodStart: toDate(item?.current_period_start),
    currentPeriodEnd: toDate(item?.current_period_end),
  };
}

function resolvePlanForSubscription(subscription: UserSubscription | null): BillingPlan | null {
  if (!subscription) return null;
  return getPlanByKey(subscription.planKey) ?? getPlanByStripePriceId(subscription.stripePriceId);
}

function resolvePlanForComplimentaryAccess(access: ComplimentaryAccess | null): BillingPlan | null {
  if (!access) return null;
  return getPlanByKey(access.planKey);
}

function isSubscriptionRecordActive(subscription: UserSubscription | null): boolean {
  if (!subscription) return false;
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) return false;
  return !subscription.currentPeriodEnd || subscription.currentPeriodEnd.getTime() >= Date.now();
}

function isComplimentaryAccessActive(access: ComplimentaryAccess | null, now: Date): boolean {
  if (!access) return false;
  return access.startsAt.getTime() <= now.getTime() && access.expiresAt.getTime() > now.getTime();
}

function getComplimentaryUsagePeriod(access: ComplimentaryAccess, now: Date): { start: Date; end: Date } {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    start: access.startsAt.getTime() > monthStart.getTime() ? access.startsAt : monthStart,
    end: access.expiresAt.getTime() < nextMonthStart.getTime() ? access.expiresAt : nextMonthStart,
  };
}

async function findUserIdForStripeSubscription(subscription: Stripe.Subscription, fallbackUserId?: string | null) {
  const customerId = getStripeObjectId(subscription.customer);
  if (!customerId) return fallbackUserId ?? null;

  const metadataUserId = subscription.metadata.userId;
  if (metadataUserId) return metadataUserId;
  if (fallbackUserId) return fallbackUserId;

  const existingSubscription = await prisma.userSubscription.findFirst({
    where: {
      OR: [{ stripeSubscriptionId: subscription.id }, { stripeCustomerId: customerId }],
    },
    select: { userId: true },
  });
  if (existingSubscription) return existingSubscription.userId;

  const user = await prisma.user.findFirst({
    where: { stripeCustomerId: customerId },
    select: { id: true },
  });

  return user?.id ?? null;
}

async function persistStripeSubscription(subscription: Stripe.Subscription, fallbackUserId?: string | null) {
  const userId = await findUserIdForStripeSubscription(subscription, fallbackUserId);
  const customerId = getStripeObjectId(subscription.customer);

  if (!userId || !customerId) {
    return null;
  }

  const { priceId, productId } = getSubscriptionPrice(subscription);
  const plan = getPlanByStripePriceId(priceId) ?? getPlanByKey(subscription.metadata.planKey);
  const { currentPeriodStart, currentPeriodEnd } = getSubscriptionPeriod(subscription);

  const syncedSubscription = await prisma.userSubscription.upsert({
    where: { userId },
    create: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      stripeProductId: productId,
      planKey: plan?.key ?? subscription.metadata.planKey ?? null,
      status: subscription.status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: toDate(subscription.canceled_at),
      trialEndsAt: toDate(subscription.trial_end),
    },
    update: {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      stripeProductId: productId,
      planKey: plan?.key ?? subscription.metadata.planKey ?? null,
      status: subscription.status,
      currentPeriodStart,
      currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      canceledAt: toDate(subscription.canceled_at),
      trialEndsAt: toDate(subscription.trial_end),
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customerId },
  });

  return syncedSubscription;
}

export async function syncStripeSubscriptionById(subscriptionId: string, fallbackUserId?: string | null) {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price.product"],
  });
  return persistStripeSubscription(subscription, fallbackUserId);
}

/**
 * Re-fetch the canonical Stripe object before writing local state. Webhook
 * deliveries are not ordered, so persisting event.data.object directly could
 * allow an older event to overwrite a newer subscription state.
 */
export async function syncStripeSubscription(subscription: Stripe.Subscription, fallbackUserId?: string | null) {
  return syncStripeSubscriptionById(subscription.id, fallbackUserId);
}

export async function syncStripeInvoiceSubscription(invoice: Stripe.Invoice) {
  const subscriptionDetails =
    invoice.parent?.type === "subscription_details" ? invoice.parent.subscription_details : null;
  const subscriptionId = getStripeObjectId(subscriptionDetails?.subscription);
  if (!subscriptionId) return null;

  return syncStripeSubscriptionById(subscriptionId, subscriptionDetails?.metadata?.userId);
}

export async function syncCheckoutSession(session: Stripe.Checkout.Session) {
  const userId = session.metadata?.userId || session.client_reference_id || null;
  const customerId = getStripeObjectId(session.customer);

  if (userId && customerId) {
    await prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customerId },
    });
  }

  const subscriptionId = getStripeObjectId(session.subscription);
  if (!subscriptionId) {
    return null;
  }

  return syncStripeSubscriptionById(subscriptionId, userId);
}

export async function getBillingStatus(userId: string, client: BillingClient = prisma): Promise<BillingStatus> {
  if (env.SELF_HOSTED) {
    const connectedAccounts = await client.connectedAccount.count({ where: { userId } });
    return {
      active: true,
      accessType: "self_hosted",
      plan: null,
      subscription: null,
      complimentaryAccess: null,
      usage: {
        connectedAccounts,
        postsThisPeriod: 0,
      },
    };
  }

  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      subscription: true,
      complimentaryAccess: true,
    },
  });

  const subscription = user?.subscription ?? null;
  const complimentaryAccess = user?.complimentaryAccess ?? null;
  const subscriptionPlan = resolvePlanForSubscription(subscription);
  const complimentaryPlan = resolvePlanForComplimentaryAccess(complimentaryAccess);
  const now = new Date();
  const stripeActive = isSubscriptionRecordActive(subscription) && subscriptionPlan !== null;
  const complimentaryActive = isComplimentaryAccessActive(complimentaryAccess, now) && complimentaryPlan !== null;
  const accessType = stripeActive ? "stripe" : complimentaryActive ? "complimentary" : null;
  const active = accessType !== null;
  const plan = stripeActive ? subscriptionPlan : complimentaryActive ? complimentaryPlan : null;
  const complimentaryPeriod = complimentaryActive
    ? getComplimentaryUsagePeriod(complimentaryAccess as ComplimentaryAccess, now)
    : null;
  const start = stripeActive
    ? (subscription?.currentPeriodStart ?? new Date(0))
    : (complimentaryPeriod?.start ?? new Date(0));
  const end = stripeActive ? (subscription?.currentPeriodEnd ?? undefined) : complimentaryPeriod?.end;
  const postWhere = {
    userId,
    createdAt: {
      gte: start,
      ...(end ? { lt: end } : {}),
    },
  };

  const [connectedAccounts, postsThisPeriod] = await Promise.all([
    client.connectedAccount.count({ where: { userId } }),
    active ? client.post.count({ where: postWhere }) : Promise.resolve(0),
  ]);

  return {
    active,
    accessType,
    plan,
    subscription: subscription
      ? {
          status: subscription.status,
          planKey: subscription.planKey,
          stripeCustomerId: subscription.stripeCustomerId,
          stripeSubscriptionId: subscription.stripeSubscriptionId,
          stripePriceId: subscription.stripePriceId,
          currentPeriodStart: toISOString(subscription.currentPeriodStart),
          currentPeriodEnd: toISOString(subscription.currentPeriodEnd),
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          canceledAt: toISOString(subscription.canceledAt),
          trialEndsAt: toISOString(subscription.trialEndsAt),
        }
      : null,
    complimentaryAccess: complimentaryAccess
      ? {
          planKey: complimentaryAccess.planKey,
          startsAt: complimentaryAccess.startsAt.toISOString(),
          expiresAt: complimentaryAccess.expiresAt.toISOString(),
          source: complimentaryAccess.source,
        }
      : null,
    usage: {
      connectedAccounts,
      postsThisPeriod,
    },
  };
}

export async function assertActiveSubscription(userId: string): Promise<BillingStatus> {
  const status = await getBillingStatus(userId);

  if (env.SELF_HOSTED) {
    return status;
  }

  if (!status.active || !status.plan) {
    throw new PaymentRequiredError("An active SimplePost subscription is required");
  }

  return status;
}

export async function assertPlanFeature(userId: string, feature: SubscriptionFeature): Promise<void> {
  if (env.SELF_HOSTED) {
    return;
  }

  const status = await assertActiveSubscription(userId);

  if (!status.plan?.limits[feature]) {
    const featureLabel = feature === "apiAccess" ? "API access" : "CLI access";
    throw new ForbiddenError(`${featureLabel} is not included in your ${status.plan?.name ?? "current"} plan`);
  }
}

export async function assertCanCreatePost(userId: string, client: BillingClient = prisma): Promise<void> {
  if (env.SELF_HOSTED) {
    return;
  }

  const status = await getBillingStatus(userId, client);
  if (!status.active || !status.plan) {
    throw new PaymentRequiredError("An active SimplePost subscription is required");
  }
  const limit = status.plan?.limits.postsPerMonth;

  if (limit && status.usage.postsThisPeriod >= limit) {
    throw new ForbiddenError(
      `Your ${status.plan?.name ?? "current"} plan includes ${limit.toLocaleString()} posts per month`,
    );
  }
}

export async function assertCanConnectAccount(
  params: {
    userId: string;
    platform: string;
    platformAccountId: string;
  },
  client: BillingClient = prisma,
): Promise<void> {
  if (env.SELF_HOSTED) {
    return;
  }

  const existingAccount = await client.connectedAccount.findUnique({
    where: {
      userId_platform_platformAccountId: {
        userId: params.userId,
        platform: params.platform,
        platformAccountId: params.platformAccountId,
      },
    },
    select: { id: true },
  });

  if (existingAccount) {
    return;
  }

  const status = await getBillingStatus(params.userId, client);
  if (!status.active || !status.plan) {
    throw new PaymentRequiredError("An active SimplePost subscription is required to connect accounts");
  }

  const accountLimit = status.plan.limits.socialAccounts;
  if (accountLimit !== null && status.usage.connectedAccounts + 1 > accountLimit) {
    throw new ForbiddenError(`Your ${status.plan.name} plan includes ${accountLimit} social accounts`);
  }
}
