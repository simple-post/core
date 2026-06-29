export const BILLING_DISPLAY_CURRENCIES = ["usd", "eur"] as const;

export type BillingDisplayCurrency = (typeof BILLING_DISPLAY_CURRENCIES)[number];

export const DEFAULT_BILLING_DISPLAY_CURRENCY: BillingDisplayCurrency = "usd";

const EUR_COUNTRY_CODES = new Set([
  "AD",
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "HR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MC",
  "ME",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
  "SM",
  "VA",
  "XK",
]);

const COUNTRY_HEADER_NAMES = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
  "x-country-code",
  "x-forwarded-country",
];

export function normalizeCountryCode(countryCode: string | null | undefined): string | null {
  const normalized = countryCode?.trim().toUpperCase();
  if (!normalized || normalized === "XX" || normalized.length !== 2) {
    return null;
  }

  return normalized;
}

export function getCountryCodeFromHeaders(headers: Pick<Headers, "get">): string | null {
  for (const headerName of COUNTRY_HEADER_NAMES) {
    const countryCode = normalizeCountryCode(headers.get(headerName));
    if (countryCode) {
      return countryCode;
    }
  }

  return null;
}

export function getBillingDisplayCurrencyForCountry(countryCode: string | null | undefined): BillingDisplayCurrency {
  return EUR_COUNTRY_CODES.has(normalizeCountryCode(countryCode) ?? "") ? "eur" : DEFAULT_BILLING_DISPLAY_CURRENCY;
}

export function getBillingDisplayCurrencyFromHeaders(headers: Pick<Headers, "get">): BillingDisplayCurrency {
  return getBillingDisplayCurrencyForCountry(getCountryCodeFromHeaders(headers));
}
