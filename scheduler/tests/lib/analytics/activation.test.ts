jest.mock("@/lib/prisma", () => ({
  prisma: {
    activationMilestone: { findUnique: jest.fn(), updateMany: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));
import {
  claimMilestoneEvents,
  landingProps,
  normalizeAiClient,
  normalizePlatform,
  unreportedMilestones,
  type MilestoneRow,
} from "@/lib/analytics/activation";
import { createFirstTouch } from "@/lib/analytics/first-touch";
import { prisma } from "@/lib/prisma";

const at = new Date("2026-09-27T10:00:00Z");
const empty: MilestoneRow = {
  signupCompletedAt: null,
  aiConnectedAt: null,
  aiClient: null,
  socialConnectedAt: null,
  socialPlatform: null,
  firstPostCreatedAt: null,
  firstPostScheduledAt: null,
  firstPostPublishedAt: null,
  subscriptionStartedAt: null,
  reportedKinds: [],
};
const acquisition = JSON.stringify(
  createFirstTouch("https://simplepost.social/platforms/linkedin/?utm_source=google", "", at),
);

beforeEach(() => jest.clearAllMocks());

describe("activation milestones", () => {
  it("maps self-reported client names to a fixed set of labels", () => {
    expect(normalizeAiClient("ChatGPT")).toBe("chatgpt");
    expect(normalizeAiClient("claude-code (simplepost)")).toBe("claude-code");
    expect(normalizeAiClient("Claude")).toBe("claude");
    expect(normalizeAiClient("Cursor")).toBe("cursor");
    expect(normalizeAiClient("SimplePost CLI")).toBe("cli");
    expect(normalizeAiClient("my private agent for jane@example.com")).toBe("other-mcp");
    expect(normalizeAiClient(null)).toBe("other-mcp");
    expect(normalizePlatform("twitter")).toBe("x");
    expect(normalizePlatform("myspace")).toBe("other");
  });

  it("derives the landing category from the stored first touch", () => {
    expect(landingProps(acquisition)).toEqual({ landing_page: "/platforms/linkedin", landing_category: "platform" });
    expect(landingProps(JSON.stringify({ version: 1, source: "unknown" }))).toEqual({
      landing_page: "unknown",
      landing_category: "unknown",
    });
    expect(landingProps({ landingPage: "/" })).toEqual({ landing_page: "/", landing_category: "home" });
    expect(landingProps({ landingPage: "/social-media-mcp-server" }).landing_category).toBe("mcp");
  });

  it("returns only reached, unreported milestones and never relays subscriptions", () => {
    const row = {
      ...empty,
      signupCompletedAt: at,
      aiConnectedAt: at,
      aiClient: "Claude",
      socialConnectedAt: at,
      socialPlatform: "linkedin",
      firstPostCreatedAt: at,
      subscriptionStartedAt: at,
      reportedKinds: ["signup_completed"],
    };
    expect(unreportedMilestones(row, acquisition)).toEqual([
      {
        kind: "ai_connected",
        name: "AI Integration Connected",
        props: { landing_page: "/platforms/linkedin", landing_category: "platform", client: "claude" },
      },
      {
        kind: "social_connected",
        name: "Social Account Connected",
        props: { landing_page: "/platforms/linkedin", landing_category: "platform", platform: "linkedin" },
      },
      {
        kind: "post_created",
        name: "First Post Created",
        props: { landing_page: "/platforms/linkedin", landing_category: "platform" },
      },
    ]);
  });

  it("claims milestones once with an optimistic update", async () => {
    (prisma.activationMilestone.findUnique as jest.Mock).mockResolvedValue({ ...empty, signupCompletedAt: at });
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ acquisition });
    (prisma.activationMilestone.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    const events = await claimMilestoneEvents("user_1");
    expect(events.map((event) => event.name)).toEqual(["Signup Completed"]);
    expect(prisma.activationMilestone.updateMany).toHaveBeenCalledWith({
      where: { userId: "user_1", reportedKinds: { equals: [] } },
      data: { reportedKinds: ["signup_completed"] },
    });
    (prisma.activationMilestone.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    expect(await claimMilestoneEvents("user_1")).toEqual([]);
  });

  it("does nothing for untracked accounts or when everything is reported", async () => {
    (prisma.activationMilestone.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ acquisition: null });
    expect(await claimMilestoneEvents("legacy")).toEqual([]);
    (prisma.activationMilestone.findUnique as jest.Mock).mockResolvedValue({
      ...empty,
      signupCompletedAt: at,
      reportedKinds: ["signup_completed"],
    });
    expect(await claimMilestoneEvents("done")).toEqual([]);
    expect(prisma.activationMilestone.updateMany).not.toHaveBeenCalled();
  });
});
