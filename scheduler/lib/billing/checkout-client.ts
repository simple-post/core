import type { PlanKey } from "@/lib/billing/plans";

async function parseApiError(response: Response): Promise<string> {
  const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
  return data.error || data.message || `Request failed with status ${response.status}`;
}

/**
 * Open Stripe Checkout for a plan. Navigates away on success, so callers only
 * need to handle the throw. Shared by every upgrade entry point (plan grid,
 * trial-expired dialog) so they cannot drift apart.
 */
export async function startPlanCheckout(planKey: PlanKey): Promise<never> {
  const response = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ planKey }),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response));
  }

  const data = (await response.json()) as { url?: string };
  if (!data.url) {
    throw new Error("Stripe did not return a checkout URL");
  }

  window.location.href = data.url;
  // The navigation above ends this task; never resolves.
  return new Promise<never>(() => {});
}
