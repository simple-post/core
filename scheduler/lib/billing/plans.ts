import type { BillingDisplayCurrency } from "@/lib/billing/display-currency";

export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

/** The purchasable plans. The free trial is deliberately not one of them. */
export const PLAN_KEYS = ["basic", "advanced", "pro"] as const;

export type PlanKey = (typeof PLAN_KEYS)[number];

export const TRIAL_PLAN_KEY = "trial";

/** Any plan that can grant access, including the non-purchasable free trial. */
export type AccessPlanKey = PlanKey | typeof TRIAL_PLAN_KEY;

/** Length of the automatic no-credit-card trial. */
export const TRIAL_DURATION_DAYS = 7;

/** Posts a trial user may schedule or publish per social platform. */
export const TRIAL_POSTS_PER_PLATFORM = 10;

/** Segments (root post included) a trial user may put in a single thread. */
export const TRIAL_MAX_THREAD_SEGMENTS = 20;

export interface BillingPlanFeature {
  label: string;
  included: boolean;
}

export interface BillingPlanLimits {
  socialAccounts: number | null;
  /** Null on the trial, where the per-platform cap is the binding limit. */
  postsPerMonth: number | null;
  /** Trial only: posts per social platform for the whole trial window. */
  postsPerPlatform: number | null;
  /** Trial only: maximum segments in one thread. */
  maxThreadSegments: number | null;
  cliAccess: boolean;
  apiAccess: boolean;
}

/** A plan that can be bought in Stripe Checkout. */
export interface BillingPlan {
  key: PlanKey;
  name: string;
  price: string;
  prices: Record<BillingDisplayCurrency, string>;
  priceMonthly: number;
  description: string;
  featured?: boolean;
  /** Empty on the trial, which is never sold through Stripe. */
  stripePriceEnv: string;
  limits: BillingPlanLimits;
  features: BillingPlanFeature[];
}

/**
 * Any plan a user can currently be on. Widens {@link BillingPlan} to include
 * the trial, which grants access but can never be selected in Checkout. That
 * distinction is what keeps `"trial"` out of every Stripe code path.
 */
export interface AccessPlan extends Omit<BillingPlan, "key"> {
  key: AccessPlanKey;
}

/**
 * The plan a user is on before they ever pay. Capability is deliberately
 * Pro-level, because the point of the trial is to show the AI/MCP integration
 * rather than ration features, with volume capped per platform, not per month.
 * Not part of {@link BILLING_PLANS}, so it can never be selected in Checkout.
 */
export const TRIAL_PLAN: AccessPlan = {
  key: TRIAL_PLAN_KEY,
  name: "Free trial",
  price: "$0",
  prices: { usd: "$0", eur: "€0" },
  priceMonthly: 0,
  description: `Every feature for ${TRIAL_DURATION_DAYS} days. No credit card required.`,
  stripePriceEnv: "",
  limits: {
    socialAccounts: null,
    postsPerMonth: null,
    postsPerPlatform: TRIAL_POSTS_PER_PLATFORM,
    maxThreadSegments: TRIAL_MAX_THREAD_SEGMENTS,
    cliAccess: true,
    apiAccess: true,
  },
  features: [
    { label: "Unlimited social accounts", included: true },
    { label: `${TRIAL_POSTS_PER_PLATFORM} posts per platform`, included: true },
    { label: "All 10 social platforms", included: true },
    { label: "Connect any AI assistant", included: true },
    { label: "Web app for scheduling", included: true },
    { label: "CLI for agents", included: true },
    { label: "API access", included: true },
  ],
};

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: "basic",
    name: "Basic",
    price: "$9",
    prices: { usd: "$9", eur: "€9" },
    priceMonthly: 9,
    description: "For solo creators posting weekly.",
    stripePriceEnv: "STRIPE_BASIC_PRICE_ID",
    limits: {
      socialAccounts: 5,
      postsPerMonth: 100,
      postsPerPlatform: null,
      maxThreadSegments: null,
      cliAccess: false,
      apiAccess: false,
    },
    features: [
      { label: "5 social accounts", included: true },
      { label: "100 posts / month", included: true },
      { label: "All 10 social platforms", included: true },
      { label: "Connect any AI assistant", included: true },
      { label: "Web app for scheduling", included: true },
      { label: "CLI for agents", included: false },
      { label: "API access", included: false },
    ],
  },
  {
    key: "advanced",
    name: "Advanced",
    price: "$19",
    prices: { usd: "$19", eur: "€19" },
    priceMonthly: 19,
    description: "For creators and small teams publishing regularly.",
    featured: true,
    stripePriceEnv: "STRIPE_ADVANCED_PRICE_ID",
    limits: {
      socialAccounts: 10,
      postsPerMonth: 500,
      postsPerPlatform: null,
      maxThreadSegments: null,
      cliAccess: true,
      apiAccess: false,
    },
    features: [
      { label: "10 social accounts", included: true },
      { label: "500 posts / month", included: true },
      { label: "All 10 social platforms", included: true },
      { label: "Connect any AI assistant", included: true },
      { label: "Web app for scheduling", included: true },
      { label: "CLI for agents", included: true },
      { label: "API access", included: false },
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "$29",
    prices: { usd: "$29", eur: "€29" },
    priceMonthly: 29,
    description: "For power users, agents, and automated workflows.",
    stripePriceEnv: "STRIPE_PRO_PRICE_ID",
    limits: {
      socialAccounts: null,
      postsPerMonth: 2000,
      postsPerPlatform: null,
      maxThreadSegments: null,
      cliAccess: true,
      apiAccess: true,
    },
    features: [
      { label: "Unlimited social accounts", included: true },
      { label: "2,000 posts / month", included: true },
      { label: "All 10 social platforms", included: true },
      { label: "Connect any AI assistant", included: true },
      { label: "Web app for scheduling", included: true },
      { label: "CLI for agents", included: true },
      { label: "API access", included: true },
    ],
  },
];

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && PLAN_KEYS.includes(value as PlanKey);
}

export function getPlanByKey(planKey: string | null | undefined): BillingPlan | null {
  if (!isPlanKey(planKey)) return null;
  return BILLING_PLANS.find((plan) => plan.key === planKey) ?? null;
}

export function getStripePriceId(planKey: PlanKey): string | null {
  const plan = getPlanByKey(planKey);
  if (!plan) return null;
  return process.env[plan.stripePriceEnv] || null;
}

export function requireStripePriceId(planKey: PlanKey): string {
  const plan = getPlanByKey(planKey);
  if (!plan) {
    throw new Error(`Unknown billing plan: ${planKey}`);
  }

  const priceId = getStripePriceId(planKey);
  if (!priceId) {
    throw new Error(`Missing required environment variable: ${plan.stripePriceEnv}`);
  }

  return priceId;
}

export function getPlanByStripePriceId(priceId: string | null | undefined): BillingPlan | null {
  if (!priceId) return null;
  return BILLING_PLANS.find((plan) => process.env[plan.stripePriceEnv] === priceId) ?? null;
}

export function getBillingPlanPrice(
  plan: {
    price: string;
    prices?: Partial<Record<BillingDisplayCurrency, string>>;
  },
  displayCurrency: BillingDisplayCurrency,
): string {
  return plan.prices?.[displayCurrency] ?? plan.price;
}

export function formatAccountLimit(plan: AccessPlan): string {
  return plan.limits.socialAccounts === null ? "Unlimited" : plan.limits.socialAccounts.toString();
}

/** Renders the volume allowance of a plan, which the trial expresses per platform. */
export function formatPostLimit(plan: AccessPlan): string {
  if (plan.limits.postsPerPlatform !== null) {
    return `${plan.limits.postsPerPlatform.toLocaleString()} / platform`;
  }
  return plan.limits.postsPerMonth === null ? "Unlimited" : plan.limits.postsPerMonth.toLocaleString();
}
