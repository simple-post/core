import { getThreadsDraftHandoffs } from "@/features/platform-options/threads-handoff";
import { preserveThreadsHandoffOptions } from "@/lib/posting/threads-handoff-options";
import type { ConnectedAccount, MediaFile, SocialPost } from "@/types";

const account = { id: "threads-1", platform: "threads" } as ConnectedAccount;
const otherAccount = { id: "instagram-1", platform: "instagram" } as ConnectedAccount;
const image: MediaFile = {
  id: "image-1",
  url: "https://storage.example/spring.jpg",
  type: "image",
  filename: "spring.jpg",
  size: 1024,
};
const draft: SocialPost = {
  id: "draft-1",
  message: "Shared caption",
  accountIds: [account.id, otherAccount.id],
  media: [image],
  status: "draft",
  scheduledFor: null,
  createdAt: new Date(0),
};

it("opens the official composer with the effective caption and keeps photos separate from the URL", () => {
  const caption = "Sale + shipping 🎉\nhttps://example.com/?key=a&key=b";
  const overrideImage = { ...image, id: "image-2", filename: "affiliate.jpg" };
  const results = getThreadsDraftHandoffs(
    { ...draft, accountOverrides: { [account.id]: { message: caption, media: [overrideImage] } } },
    [otherAccount, account],
  );

  expect(results).toHaveLength(1);
  const [result] = results;
  expect(result).toMatchObject({ account, caption, media: [overrideImage] });
  const intent = new URL(result.intentUrl);
  expect(intent.origin + intent.pathname).toBe("https://www.threads.com/intent/post");
  expect([...intent.searchParams]).toEqual([["text", caption]]);
});

it("allows an image-only draft without adding an empty text parameter", () => {
  const [result] = getThreadsDraftHandoffs({ ...draft, accountOverrides: { [account.id]: { message: "" } } }, [
    account,
  ]);
  expect(result.intentUrl).toBe("https://www.threads.com/intent/post");
  expect(result.media).toEqual([image]);
});

it.each<Partial<SocialPost>>([
  { status: "scheduled" },
  { status: "published" },
  { quotePostId: "source-post" },
  { workspaceReviewId: "review-1" },
  { thread: [{ message: "Follow-up" }] },
  { accountOptions: { [account.id]: { replyToId: "native-post" } } },
  { message: "", media: [] },
  { accountIds: [otherAccount.id] },
])("does not hand off unsupported or non-draft content: %j", (patch) => {
  expect(getThreadsDraftHandoffs({ ...draft, ...patch }, [account, otherAccount])).toEqual([]);
});

it("preserves the manual publishing choice through omitted and replacement options", () => {
  const previous = { [account.id]: { finishInThreads: true } };

  expect(preserveThreadsHandoffOptions([account.id], previous, undefined)).toEqual(previous);
  expect(preserveThreadsHandoffOptions([account.id], previous, { [account.id]: {} })).toEqual(previous);
  expect(preserveThreadsHandoffOptions([account.id], previous, { [account.id]: { finishInThreads: false } })).toEqual({
    [account.id]: { finishInThreads: false },
  });
  expect(preserveThreadsHandoffOptions([otherAccount.id], previous, undefined)).toBeUndefined();
});
