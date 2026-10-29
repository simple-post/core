/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement } from "react";

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

import { CreatePostForm } from "@/components/create-post-form";
import { PostForm } from "@/components/post-form";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { SocialPost } from "@/types";

const mockPush = jest.fn();
const mockSubmit = jest.fn();
const mockClear = jest.fn();
const mockReset = jest.fn();
const mockSelect = jest.fn();
const mockValidation = {
  summary: { isValid: true, errors: [], warnings: [], errorCount: 0, warningCount: 0 },
  results: [],
  accounts: [],
};
let mockModal: Record<string, any>;
const mockAccounts = ["sent", "failed"].map((id) => ({ id, platform: "linkedin", username: id }));
const mockDraft = {
  message: "My post",
  media: [],
  selectedAccountIds: ["sent", "failed"],
  postingMode: "now",
  scheduledDate: "",
  scheduledTime: "",
  accountOptions: {},
  accountOverrides: {},
  repostSettings: { enabled: false, delayHours: 12 },
  thread: [],
  quotePostId: null,
  hasDraftContent: true,
  isHydrated: true,
  storageError: null,
  setMessage: jest.fn(),
  setMedia: jest.fn(),
  setSelectedAccountIds: mockSelect,
  setPostingMode: jest.fn(),
  setScheduledDate: jest.fn(),
  setScheduledTime: jest.fn(),
  setAccountOptions: jest.fn(),
  setAccountOverrideMedia: jest.fn(),
  setAccountOverrideThread: jest.fn(),
  setThread: jest.fn(),
  setQuotePostId: jest.fn(),
  setRepostSettings: jest.fn(),
  addThreadSegment: jest.fn(),
  removeThreadSegment: jest.fn(),
  updateThreadSegmentMessage: jest.fn(),
  updateThreadSegmentMedia: jest.fn(),
  resetDraft: mockReset,
  saveRecoveryDraft: jest.fn().mockReturnValue(true),
  clearRecoveryDraft: mockClear,
};
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock("@/hooks/use-accounts", () => ({ useAccounts: () => ({ data: mockAccounts, isLoading: false }) }));
jest.mock("@/hooks/use-features", () => ({ useFeatures: () => ({ hasFeature: () => false }) }));
jest.mock("@/hooks/use-posts", () => ({ usePost: () => ({ data: undefined }) }));
jest.mock("@/hooks/use-repost-settings", () => ({ useRepostSettings: () => ({ data: undefined }) }));
jest.mock("@/hooks/use-mutations", () => ({ useSubmitPost: () => ({ mutateAsync: mockSubmit, isPending: false }) }));
jest.mock("@/components/post-draft-context", () => ({ usePostDraft: () => mockDraft }));
jest.mock("@/lib/validation/post-validation", () => ({ validatePostForResolvedAccounts: () => mockValidation }));
jest.mock("@/features/platform-preview", () => ({ PlatformPostPreview: () => null }));
jest.mock("@/components/billing/trial-post-allowance", () => ({
  useTrialPostAllowance: () => ({ blocked: false, maxThreadSegments: 20 }),
  TrialLimitNotice: () => null,
  TrialExpiryScheduleWarningNotice: () => null,
}));
jest.mock("@/components/account-selector", () => ({ AccountSelector: () => null }));
jest.mock("@/components/post-content-editor", () => ({ PostContentEditor: () => null }));
jest.mock("@/components/tiktok-settings", () => ({ TikTokSettings: () => null }));
jest.mock("@/components/post-links-modal", () => ({
  PostLinksModal: (props: Record<string, any>) => {
    mockModal = props;
    return null;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => mockValidation });
  mockSubmit.mockResolvedValue({
    post: { id: "saved-post", status: "failed" },
    postingResults: [
      { accountId: "sent", platform: "linkedin", success: true },
      { accountId: "failed", platform: "linkedin", success: false, error: "Publish failed" },
    ],
  });
});
afterEach(cleanup);

function mountForm(element: React.ReactElement) {
  return render(createElement(TooltipProvider, { children: element }));
}

it.each(["create", "duplicate"])(
  "%s clears or leaves the composer and recovers through the saved post after a partial failure",
  async (mode) => {
    const existingPost = {
      id: "original",
      status: "published",
      message: "Original",
      media: [],
      accountIds: ["sent", "failed"],
    } as unknown as SocialPost;
    const view =
      mode === "create"
        ? mountForm(createElement(CreatePostForm))
        : mountForm(createElement(PostForm, { mode: "duplicate", existingPost }));
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(mockModal.postId).toBe("saved-post"));
    expect(mockModal.onEditFailed).toBeUndefined();
    expect(mockClear).toHaveBeenCalled();
    expect(mockReset).toHaveBeenCalled();
    act(() => mockModal.onOpenChange(false));
    expect(mockPush).toHaveBeenCalledWith("/posts/saved-post");
  },
);

it("keeps an existing failed post's retry in its editor and selects only the failed account", async () => {
  const existingPost = {
    id: "saved-post",
    status: "failed",
    message: "Original",
    media: [],
    accountIds: ["sent", "failed"],
  } as unknown as SocialPost;
  const view = mountForm(createElement(PostForm, { mode: "retry", existingPost }));
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(mockSubmit).toHaveBeenCalled());
  expect(mockModal.onEditFailed).toBe(mockSelect);
  mockModal.onEditFailed(["failed"]);
  expect(mockSelect).toHaveBeenCalledWith(["failed"]);
});

it.each(["create", "duplicate"])(
  "%s drops an earlier saved-post ID when a new attempt loses its response",
  async (mode) => {
    const existingPost = {
      id: "original",
      status: "published",
      message: "Original",
      media: [],
      accountIds: ["sent", "failed"],
    } as unknown as SocialPost;
    const view =
      mode === "create"
        ? mountForm(createElement(CreatePostForm))
        : mountForm(createElement(PostForm, { mode: "duplicate", existingPost }));
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(mockModal.postId).toBe("saved-post"));
    mockSubmit.mockRejectedValueOnce(new TypeError("Connection lost"));
    fireEvent.submit(view.container.querySelector("form")!);
    await waitFor(() => expect(mockModal.results[0]?.uncertain).toBe(true));
    expect(mockModal.postId).toBeUndefined();
  },
);
