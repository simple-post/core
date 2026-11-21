import { BILLING_PLANS, TRIAL_PLAN, getBillingPlanPrice } from "@/lib/billing/plans";
import { accountLimit, planName, planDescription, postLimit, accountAllowance } from "@/lib/i18n/billing-display";
import type { SourceCopy } from "@/lib/i18n/source-copy";
import { createTranslator } from "@/lib/i18n/translate";

it("localizes display copy without mutating prices, limits, plan IDs or custom names", () => {
  const before = JSON.stringify(BILLING_PLANS);
  const copy = createTranslator("ar", {
    Basic: "BASIC_DISPLAY",
    "For solo creators posting weekly.": "DESCRIPTION_DISPLAY",
    "{{count, number}} social accounts_few": "ACCOUNTS {{count, number}}",
  }) as SourceCopy;
  const basic = BILLING_PLANS[0];
  expect(planName(basic.name, copy)).toBe("BASIC_DISPLAY");
  expect(planDescription(basic.description, copy)).toBe("DESCRIPTION_DISPLAY");
  expect(accountLimit(basic, "ar", copy)).toBe(new Intl.NumberFormat("ar").format(5));
  expect(accountAllowance(basic, copy)).toBe(`ACCOUNTS ${new Intl.NumberFormat("ar").format(5)}`);
  expect(getBillingPlanPrice(basic, "eur")).toBe("€9");
  expect(postLimit(TRIAL_PLAN, "ar", copy)).toContain(new Intl.NumberFormat("ar").format(10));
  expect(planName("Custom 日本語", copy)).toBe("Custom 日本語");
  expect(JSON.stringify(BILLING_PLANS)).toBe(before);
});
