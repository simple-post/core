import { buildLandingReport, landingGroup, rate, type LandingAccount } from "@/lib/analytics/landing-report";

const now = new Date("2026-10-10");
const day = (value: string) => new Date(`${value}T12:00:00Z`);
function account(
  landingPage: string,
  milestone: Partial<NonNullable<LandingAccount["activationMilestone"]>> = {},
  paid?: string,
): LandingAccount {
  return {
    acquisition: JSON.stringify({ version: 1, source: "google", landingPage }),
    firstPayment: paid ? { paidAt: day(paid) } : null,
    activationMilestone: {
      socialConnectedAt: null,
      aiConnectedAt: null,
      firstPostCreatedAt: null,
      firstPostScheduledAt: null,
      firstPostPublishedAt: null,
      ...milestone,
    },
  };
}

describe("landing activation report", () => {
  it("maps stored landing routes to categories", () => {
    expect(landingGroup("/platforms/linkedin")).toBe("platform");
    expect(landingGroup("/ai/claude")).toBe("ai_client");
    expect(landingGroup("/instagram-from-chatgpt")).toBe("guide");
    expect(landingGroup("/social-media-mcp-server")).toBe("mcp");
    expect(landingGroup("/")).toBe("home");
    expect(landingGroup("/app/schedule")).toBe("app");
    expect(landingGroup("/other")).toBe("other");
    expect(landingGroup("—")).toBe("unknown");
  });

  it("counts milestones per category and per SEO page, ignoring future timestamps", () => {
    const report = buildLandingReport(
      [
        account(
          "/platforms/linkedin",
          { socialConnectedAt: day("2026-10-01"), firstPostPublishedAt: day("2026-10-02") },
          "2026-10-08",
        ),
        account("/platforms/linkedin", {
          socialConnectedAt: day("2026-10-01"),
          firstPostScheduledAt: day("2026-10-20"),
        }),
        account("/platforms/x", { aiConnectedAt: day("2026-10-01") }),
        account("/"),
        {
          acquisition: JSON.stringify({ version: 1, source: "unknown" }),
          firstPayment: null,
          activationMilestone: null,
        },
      ],
      now,
    );
    expect(report.categories[0]).toEqual({
      key: "platform",
      signups: 3,
      socialConnected: 2,
      aiConnected: 1,
      postCreated: 0,
      postScheduled: 0,
      postPublished: 1,
      paid: 1,
    });
    expect(report.categories.map((row) => row.key).sort()).toEqual(["home", "platform", "unknown"]);
    expect(report.pages.map((row) => [row.key, row.signups])).toEqual([
      ["/platforms/linkedin", 2],
      ["/platforms/x", 1],
    ]);
    expect(rate(1, 3)).toBe("33%");
    expect(rate(0, 0)).toBe("—");
  });
});
