import type Stripe from "stripe";

/** Extract a user-requested cancellation episode, shared by both Stripe event types. */
export function getStripeCancellation(event: Stripe.Event) {
  if (event.type !== "customer.subscription.updated" && event.type !== "customer.subscription.deleted") return null;
  const subscription = event.data.object;
  const reason = subscription.cancellation_details?.reason;
  let requestedAt: number;
  let effectiveAt: number | null | undefined;
  if (event.type === "customer.subscription.updated") {
    const previous = event.data.previous_attributes;
    const justSetPeriodEnd = previous?.cancel_at_period_end === false && subscription.cancel_at_period_end;
    const justSetCustomEnd = previous?.cancel_at === null && reason === "cancellation_requested";
    if ((!justSetPeriodEnd && !justSetCustomEnd) || (reason && reason !== "cancellation_requested")) return null;
    requestedAt = subscription.canceled_at ?? event.created;
    effectiveAt =
      subscription.cancel_at ??
      (subscription.cancel_at_period_end ? subscription.items.data[0]?.current_period_end : null);
  } else {
    // A normal period-end deletion follows the confirmation already sent at request time.
    if (subscription.cancel_at_period_end || reason !== "cancellation_requested") return null;
    requestedAt = subscription.canceled_at ?? event.created;
    effectiveAt = subscription.ended_at ?? requestedAt;
    if (subscription.cancel_at && subscription.cancel_at === effectiveAt && requestedAt < effectiveAt) return null;
  }
  if (!effectiveAt) return null;

  return {
    key: `billing-cancellation/${subscription.id}/${requestedAt}`,
    kind: "paid_cancellation" as const,
    occurredAt: new Date(requestedAt * 1000),
    effectiveAt: new Date(effectiveAt * 1000),
  };
}
