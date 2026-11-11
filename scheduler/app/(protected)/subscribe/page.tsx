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
import { planName } from "@/lib/i18n/billing-display";
import { getUiCopy } from "@/lib/i18n/request-copy";

interface SubscribePageProps {
  searchParams?: Promise<{
    checkout?: string | string[];
    plan?: string | string[];
  }>;
}

export default async function SubscribePage({ searchParams }: SubscribePageProps) {
  const { copy, locale } = await getUiCopy();
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
  const freeTrial = billing?.accessType === "trial" ? billing.trial : null;
  // A linked plan is a preference only. Checkout requires an explicit button click.
  const selectedPlanKey = selectedPlan?.key;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        {freeTrial ? (
          <div className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] pt-6">
            <Alert className="border-primary/30 bg-primary/10">
              <AlertTitle>{copy("You are on the free trial")}</AlertTitle>
              <AlertDescription>
                {copy(
                  "Every feature is unlocked through {{date}}. No payment method is required unless you choose a paid plan below.",
                  {
                    date: new Date(freeTrial.expiresAt).toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }),
                  },
                )}
              </AlertDescription>
            </Alert>
          </div>
        ) : complimentaryPlan ? (
          <div className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] pt-6">
            <Alert className="border-primary/30 bg-primary/10">
              <AlertTitle>
                {copy("You already have complimentary {{plan}} access", {
                  plan: planName(complimentaryPlan.name, copy),
                })}
              </AlertTitle>
              <AlertDescription>
                {copy(
                  "No payment method is required through {{date}}. Choose a plan below only if you want to start a paid subscription now.",
                  {
                    date: new Date(complimentaryExpiresAt ?? "").toLocaleDateString(locale, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    }),
                  },
                )}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        {checkout === "cancelled" ? (
          <div className="mx-auto w-full max-w-6xl px-[clamp(18px,4vw,48px)] pt-6">
            <Alert className="border-border bg-card">
              <AlertTitle>{copy("Checkout canceled")}</AlertTitle>
              <AlertDescription>
                {copy("No subscription was created. Choose a plan when you are ready.")}
              </AlertDescription>
            </Alert>
          </div>
        ) : null}
        <PlanSelection
          title={freeTrial || complimentaryPlan ? copy("Choose a paid plan") : undefined}
          description={
            freeTrial
              ? copy("Your free trial stays active until you subscribe or it expires.")
              : complimentaryPlan
                ? copy(
                    "Your complimentary access remains free until you subscribe or it expires. Paid plans are optional.",
                  )
                : undefined
          }
          displayCurrency={displayCurrency}
          selectedPlanKey={selectedPlanKey}
        />
      </main>
    </div>
  );
}
