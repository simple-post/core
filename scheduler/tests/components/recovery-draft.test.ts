/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement } from "react";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { buildExistingPostDraft } from "@/components/edit-post-draft";
import { PostDraftProvider, usePostDraft } from "@/components/post-draft-context";
import type { SocialPost } from "@/types";

jest.mock("@/lib/auth/auth-client", () => ({ useSession: () => ({ data: { user: { id: "owner" } } }) }));
const initialDraft = buildExistingPostDraft(
  { message: "Original", media: [], accountIds: ["sent", "failed"], status: "failed" } as unknown as SocialPost,
  "retry",
);
function Editor() {
  const draft = usePostDraft();
  return createElement(
    "div",
    null,
    createElement("input", {
      "aria-label": "Content",
      value: draft.message,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => draft.setMessage(event.target.value),
    }),
    createElement("span", { "data-testid": "accounts" }, draft.selectedAccountIds.join(",")),
    createElement("button", { onClick: () => draft.saveRecoveryDraft("/posts/saved/edit", ["failed"]) }, "Reconnect"),
    createElement("button", { onClick: draft.clearRecoveryDraft }, "Saved successfully"),
  );
}
function mount() {
  return render(createElement(PostDraftProvider, { initialDraft, children: createElement(Editor) }));
}
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/posts/saved/edit");
});
afterEach(cleanup);

it("restores edited content and only failed destinations after a full-page reconnect, once", async () => {
  const editor = mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Edited before reconnect" } });
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  editor.unmount();
  window.history.replaceState(null, "", "/posts/saved/edit?resumeDraft=1");
  const restored = mount();
  await waitFor(() => expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Edited before reconnect"));
  expect(screen.getByTestId("accounts").textContent).toBe("failed");
  expect(sessionStorage.length).toBe(0);
  expect(window.location.search).toBe("");
  restored.unmount();
  mount();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Original");
});

it("does not restore the snapshot into another post's editor", () => {
  const editor = mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Private edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  editor.unmount();
  window.history.replaceState(null, "", "/posts/other/edit?resumeDraft=1");
  mount();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Original");
});

it("does not overwrite an ordinary visit to the same post with an abandoned reconnect snapshot", () => {
  const editor = mount();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Abandoned edit" } });
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  editor.unmount();
  mount();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Original");
});

it("discards an abandoned snapshot after a successful save", () => {
  const editor = mount();
  fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
  fireEvent.click(screen.getByRole("button", { name: "Saved successfully" }));
  expect(sessionStorage.length).toBe(0);
  editor.unmount();
  window.history.replaceState(null, "", "/posts/saved/edit?resumeDraft=1");
  mount();
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Original");
});
