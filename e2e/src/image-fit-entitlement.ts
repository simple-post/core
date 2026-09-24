import type { SchedulerApi } from "./http.js";
import type { Interface, Scenario } from "./types.js";

// Run only for a new hosted fitting attempt. Existing receipts can still be
// verified, and local CLI fitting does not depend on the hosted entitlement.
export async function assertImageFitEntitlement(
  api: Pick<SchedulerApi, "request">,
  scenario: Pick<Scenario, "imageFit">,
  iface: Interface,
) {
  if (!scenario.imageFit || (iface !== "ui" && iface !== "mcp")) return;
  let data: { features?: unknown } | null;
  try {
    data = await api.request("/api/v1/features");
  } catch (error) {
    throw new Error(
      `BLOCKED: cannot verify IMAGE_FITTING entitlement for this hosted fitting case. No fitting submission sent. ${(error as Error).message}`,
    );
  }
  if (!Array.isArray(data?.features) || !data.features.every((feature) => typeof feature === "string"))
    throw new Error("BLOCKED: invalid IMAGE_FITTING feature response. No fitting submission sent.");
  if (!data.features.includes("IMAGE_FITTING"))
    throw new Error("BLOCKED: this test user needs IMAGE_FITTING enabled. No fitting submission sent.");
}
