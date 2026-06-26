export const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export const PLAN_KEYS = ["basic", "advanced", "pro"] as const;

export type PlanKey = (typeof PLAN_KEYS)[number];

export interface BillingPlanFeature {
  label: string;
  included: boolean;
}

export interface BillingPlanLimits {
  socialAccounts: number | null;
  postsPerMonth: number;
  cliAccess: boolean;
  apiAccess: boolean;
}

export interface BillingPlan {
  key: PlanKey;
  name: string;
  price: string;
  priceMonthly: number;
  description: string;
  featured?: boolean;
  stripePriceEnv: string;
  limits: BillingPlanLimits;
  features: BillingPlanFeature[];
}

export const BILLING_PLANS: BillingPlan[] = [
  {
    key: "basic",
    name: "Basic",
    price: "$9",
    priceMonthly: 9,
    description: "For solo creators posting weekly.",
    stripePriceEnv: "STRIPE_BASIC_PRICE_ID",
    limits: {
      socialAccounts: 5,
      postsPerMonth: 100,
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
    priceMonthly: 19,
    description: "For creators and small teams publishing regularly.",
    featured: true,
    stripePriceEnv: "STRIPE_ADVANCED_PRICE_ID",
    limits: {
      socialAccounts: 10,
      postsPerMonth: 500,
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
    priceMonthly: 29,
    description: "For power users, agents, and automated workflows.",
    stripePriceEnv: "STRIPE_PRO_PRICE_ID",
    limits: {
      socialAccounts: null,
      postsPerMonth: 2000,
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

export function formatAccountLimit(plan: BillingPlan): string {
  return plan.limits.socialAccounts === null ? "Unlimited" : plan.limits.socialAccounts.toString();
}
