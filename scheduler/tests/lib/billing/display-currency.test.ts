import {
  getBillingDisplayCurrencyForCountry,
  getBillingDisplayCurrencyFromHeaders,
  getCountryCodeFromHeaders,
} from "@/lib/billing/display-currency";

describe("billing display currency", () => {
  it("uses EUR for Euro countries", () => {
    expect(getBillingDisplayCurrencyForCountry("DE")).toBe("eur");
    expect(getBillingDisplayCurrencyForCountry("fr")).toBe("eur");
    expect(getBillingDisplayCurrencyForCountry("XK")).toBe("eur");
  });

  it("falls back to USD outside Euro countries or when unknown", () => {
    expect(getBillingDisplayCurrencyForCountry("US")).toBe("usd");
    expect(getBillingDisplayCurrencyForCountry("GB")).toBe("usd");
    expect(getBillingDisplayCurrencyForCountry("XX")).toBe("usd");
    expect(getBillingDisplayCurrencyForCountry(null)).toBe("usd");
  });

  it("reads Cloudflare country headers first", () => {
    const headers = new Headers({
      "cf-ipcountry": "NL",
      "x-vercel-ip-country": "US",
    });

    expect(getCountryCodeFromHeaders(headers)).toBe("NL");
    expect(getBillingDisplayCurrencyFromHeaders(headers)).toBe("eur");
  });
});
