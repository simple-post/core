import { createElement } from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { PlatformPostPreview } from "@/features/platform-preview";
import type { ConnectedAccount, MediaFile, ThreadSegment } from "@/types";

import type { PostPreviewData } from "@simple-post/preview-react";

let mockPreviewData: PostPreviewData | undefined;

jest.mock("@simple-post/preview-react", () => ({
  PostPreview: ({ data }: { data: PostPreviewData }) => {
    mockPreviewData = data;
    return null;
  },
}));

const account = {
  id: "account-1",
  platform: "x",
  displayName: "Example",
  username: "example",
  profilePicture: null,
  updatedAt: new Date("2026-01-01"),
} as ConnectedAccount;

function image(id: string): MediaFile {
  return { id, type: "image", url: `https://example.com/${id}.jpg`, filename: `${id}.jpg` } as MediaFile;
}

function renderPreview(props: Partial<Parameters<typeof PlatformPostPreview>[0]> = {}): PostPreviewData | undefined {
  mockPreviewData = undefined;
  renderToStaticMarkup(
    createElement(PlatformPostPreview, {
      message: "Root post",
      media: [image("root-1"), image("root-2"), image("root-3")],
      selectedAccounts: [account],
      ...props,
    }),
  );
  return mockPreviewData as PostPreviewData | undefined;
}

describe("scheduler post preview content", () => {
  it("sends every root image and every reply image to an expanded preview", () => {
    const thread: ThreadSegment[] = Array.from({ length: 12 }, (_, index) => ({
      message: `Reply ${index + 1}`,
      media: [image(`reply-${index + 1}-a`), image(`reply-${index + 1}-b`)],
    }));

    const preview = renderPreview({ thread });

    expect(preview?.threadLayout).toBe("expand");
    expect(preview?.media?.map((item) => item.id)).toEqual(["root-1", "root-2", "root-3"]);
    expect(preview?.thread).toHaveLength(12);
    expect(preview?.thread?.[11]?.media?.map((item) => item.id)).toEqual(["reply-12-a", "reply-12-b"]);
  });

  it("uses account-specific thread and image overrides when present", () => {
    const preview = renderPreview({
      thread: [{ message: "Shared reply", media: [image("shared")] }],
      accountOverrides: {
        "account-1": {
          media: [image("override-1"), image("override-2")],
          thread: [{ message: "Account reply", media: [image("override-reply-1"), image("override-reply-2")] }],
        },
      },
    });

    expect(preview?.media?.map((item) => item.id)).toEqual(["override-1", "override-2"]);
    expect(preview?.thread?.[0]?.message).toBe("Account reply");
    expect(preview?.thread?.[0]?.media?.map((item) => item.id)).toEqual(["override-reply-1", "override-reply-2"]);
  });
});
