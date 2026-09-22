import type Stripe from "stripe";

/** Only a real, recent, positive-value settled checkout is a paid conversion. */
export function paidConversion(
  session: Pick<
    Stripe.Checkout.Session,
    "mode" | "status" | "payment_status" | "livemode" | "amount_total" | "created" | "metadata"
  >,
  now = Date.now(),
): { plan: string } | null {
  const age = now / 1000 - session.created;
  const plan = session.metadata?.planKey;
  if (
    session.mode !== "subscription" ||
    session.status !== "complete" ||
    session.payment_status !== "paid" ||
    !session.livemode ||
    !session.amount_total ||
    session.amount_total <= 0 ||
    age < 0 ||
    age > 86_400 ||
    !plan ||
    !["basic", "advanced", "pro"].includes(plan)
  )
    return null;
  return { plan };
}
