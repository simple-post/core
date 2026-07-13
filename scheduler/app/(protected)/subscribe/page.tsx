import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { PlanSelection } from "@/components/billing/plan-selection";
import { Navbar } from "@/components/navbar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { auth } from "@/lib/auth/auth";
import { getBillingDisplayCurrencyFromHeaders } from "@/lib/billing/display-currency";
import { getPlanByKey } from "@/lib/billing/plans";
import { getBillingStatus } from "@/lib/billing/subscriptions";
import { env } from "@/lib/env";

interface SubscribePageProps {
  searchParams?: Promise<{
    checkout?: string | string[];
    plan?: string | string[];
  }>;
}

export default async function SubscribePage({ searchParams }: SubscribePageProps) {
  if (env.SELF_HOSTED) {
    redirect("/");
  }

  const params = (await searchParams) ?? {};
  const checkout = Array.isArray(params.checkout) ? params.checkout[0] : params.checkout;
  const planParam = Array.isArray(params.plan) ? params.plan[0] : params.plan;
  const selectedPlan = getPlanByKey(planParam);
  const requestHeaders = await headers();
  const displayCurrency = getBillingDisplayCurrencyFromHeaders(requestHeaders);
  const session = await auth.api.getSession({ headers: requestHeaders });
  const billing = session?.user?.id ? await getBillingStatus(session.user.id) : null;
  const complimentaryPlan = billing?.accessType === "complimentary" ? billing.plan : null;
  const complimentaryExpiresAt = billing?.complimentaryAccess?.expiresAt ?? null;
  const autoStartPlanKey = checkout === "cancelled" ? null : selectedPlan?.key;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        {complimentaryPlan ? (
          <div className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] pt-6">
            <Alert className="border-primary/30 bg-primary/10">
              <AlertTitle>You already have complimentary {complimentaryPlan.name} access</AlertTitle>
              <AlertDescription>
                No payment method is required through{" "}
                {new Date(complimentaryExpiresAt ?? "").toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                . Choose a plan below only if you want to start a paid subscription now.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        {checkout === "cancelled" ? (
          <div className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] pt-6">
            <Alert className="border-border bg-card">
              <AlertTitle>Checkout canceled</AlertTitle>
              <AlertDescription>No subscription was created. Choose a plan when you are ready.</AlertDescription>
            </Alert>
          </div>
        ) : null}
        <PlanSelection
          title={complimentaryPlan ? "Start a paid subscription" : undefined}
          description={
            complimentaryPlan
              ? "Your complimentary access remains free until you subscribe or it expires. Paid plans are optional."
              : undefined
          }
          displayCurrency={displayCurrency}
          autoStartPlanKey={autoStartPlanKey}
        />
      </main>
    </div>
  );
}
