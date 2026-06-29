import { headers } from "next/headers";

import { PlanSelection } from "@/components/billing/plan-selection";
import { Navbar } from "@/components/navbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getBillingDisplayCurrencyFromHeaders } from "@/lib/billing/display-currency";
import { getPlanByKey } from "@/lib/billing/plans";

interface SubscribePageProps {
  searchParams?: Promise<{
    checkout?: string | string[];
    plan?: string | string[];
  }>;
}

export default async function SubscribePage({ searchParams }: SubscribePageProps) {
  const params = (await searchParams) ?? {};
  const checkout = Array.isArray(params.checkout) ? params.checkout[0] : params.checkout;
  const planParam = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  const selectedPlan = getPlanByKey(planParam);
  const displayCurrency = getBillingDisplayCurrencyFromHeaders(await headers());
  const autoStartPlanKey = checkout === "cancelled" ? null : selectedPlan?.key;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        {checkout === "cancelled" ? (
          <div className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] pt-6">
            <Alert className="border-border bg-card">
              <AlertTitle>Checkout canceled</AlertTitle>
              <AlertDescription>No subscription was created. Choose a plan when you are ready.</AlertDescription>
            </Alert>
          </div>
        ) : null}
        <PlanSelection displayCurrency={displayCurrency} autoStartPlanKey={autoStartPlanKey} />
      </main>
    </div>
  );
}
