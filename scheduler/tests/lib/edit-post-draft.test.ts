import { buildExistingPostDraft } from "@/components/edit-post-draft";
import type { SocialPost } from "@/types";

const image = { id: "img", type: "image" as const, url: "https://example.com/a.jpg", filename: "a.jpg", size: 1 };

const post = {
  id: "post-1",
  message: "Long post for X and LinkedIn",
  accountIds: ["x-1", "bluesky-1", "tiktok-1"],
  media: [image],
  thread: [],
  scheduledFor: new Date("2099-01-01T10:00:00"),
  status: "scheduled",
  createdAt: new Date(),
  accountOptions: { "tiktok-1": { privacyLevel: "SELF_ONLY" } },
  accountOverrides: { "bluesky-1": { message: "Part 1", thread: [{ message: "Part 2" }] } },
  accountResults: { "tiktok-1": { accountId: "tiktok-1", success: false } },
} as unknown as SocialPost;

it("keeps a scheduled post's content, schedule, settings and per-account threads", () => {
  const draft = buildExistingPostDraft(post, "edit");

  expect(draft).toMatchObject({
    message: "Long post for X and LinkedIn",
    selectedAccountIds: ["x-1", "bluesky-1", "tiktok-1"],
    postingMode: "schedule",
    scheduledDate: "2099-01-01",
    scheduledTime: "10:00",
    accountOptions: { "tiktok-1": { privacyLevel: "SELF_ONLY" } },
  });
  // Omitted override fields are filled from the shared content, as the composer's customize page does.
  expect(draft.accountOverrides).toEqual({
    "bluesky-1": { enabled: true, message: "Part 1", media: [image], thread: [{ message: "Part 2" }] },
  });
});

it("targets only the failed accounts on retry and publishes now", () => {
  const draft = buildExistingPostDraft({ ...post, status: "failed" }, "retry");

  expect(draft.selectedAccountIds).toEqual(["tiktok-1"]);
  expect(draft.postingMode).toBe("now");
});

it("drops the schedule when duplicating", () => {
  const draft = buildExistingPostDraft(post, "duplicate");

  expect(draft).toMatchObject({ postingMode: "now", scheduledDate: "", scheduledTime: "" });
});
