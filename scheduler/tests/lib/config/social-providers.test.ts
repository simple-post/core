import { ALL_SOCIAL_PLATFORMS, SOCIAL_PLATFORM_IDS, parseEnabledSocialProviderIds } from "@/lib/config";

describe("social provider feature flags", () => {
  it("disables every provider when the environment variable is missing or empty", () => {
    expect(parseEnabledSocialProviderIds(undefined)).toEqual(new Set());
    expect(parseEnabledSocialProviderIds("  ")).toEqual(new Set());
  });

  it("enables only explicitly listed supported providers", () => {
    expect(parseEnabledSocialProviderIds(" X, forem,unknown,FOREM ")).toEqual(new Set(["x", "forem"]));
  });

  it("supports an explicit wildcard", () => {
    expect(parseEnabledSocialProviderIds("*")).toEqual(new Set(SOCIAL_PLATFORM_IDS));
    expect(SOCIAL_PLATFORM_IDS).toEqual(ALL_SOCIAL_PLATFORMS.map((platform) => platform.id));
  });
});
