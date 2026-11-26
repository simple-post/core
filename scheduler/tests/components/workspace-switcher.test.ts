/** @jest-environment jsdom */
Object.defineProperty(process.env, "NODE_ENV", { value: "test", writable: true });
import { createElement } from "react";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { WorkspaceSwitcher } from "@/components/workspaces/switcher";
import { request, type WorkspaceIndex } from "@/components/workspaces/types";

const mockPush = jest.fn();
const mockParams = new URLSearchParams();
let mockEnabled = true;
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockParams,
  usePathname: () => "/",
}));
jest.mock("@/lib/auth/auth-client", () => ({ useSession: () => ({ data: { user: { id: "signed-in" } } }) }));
jest.mock("@/hooks/use-features", () => ({ useFeatures: () => ({ hasFeature: () => mockEnabled }) }));
jest.mock("@/components/workspaces/types", () => ({
  ...jest.requireActual("@/components/workspaces/types"),
  request: jest.fn(),
}));

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
  mockParams.delete("workspace");
  mockEnabled = true;
});
function mount(index: Partial<WorkspaceIndex> = {}) {
  jest
    .mocked(request)
    .mockResolvedValue({ personal: { name: "Personal", color: "slate" }, workspaces: [], invites: [], ...index });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(createElement(QueryClientProvider, { client }, createElement(WorkspaceSwitcher)));
  return client;
}
it("leaves the ordinary dashboard alone when the rollout is off", () => {
  mockEnabled = false;
  mockParams.set("workspace", "studio");
  mount({ workspaces: [{ id: "studio", name: "Studio", icon: "S", color: "indigo", canManage: true, role: "Admin" }] });
  expect(screen.queryByRole("button")).toBeNull();
  expect(request).not.toHaveBeenCalled();
});
it("lets an eligible personal account create its first workspace", async () => {
  mount();
  fireEvent.keyDown(await screen.findByRole("button", { name: "Switch workspace: Personal" }), { key: "ArrowDown" });
  expect(await screen.findByRole("menuitem", { name: "Create workspace" })).toBeTruthy();
});
it("lets an invited viewer return to Personal without exposing admin settings", async () => {
  mockParams.set("workspace", "studio");
  mount({
    workspaces: [{ id: "studio", role: "Viewer", name: "Studio", icon: "S", color: "indigo", canManage: false }],
  });
  fireEvent.keyDown(await screen.findByRole("button", { name: "Switch workspace: Studio" }), { key: "ArrowDown" });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Personal" }));
  expect(mockPush).toHaveBeenCalledWith("/");
  fireEvent.keyDown(screen.getByRole("button", { name: "Switch workspace: Studio" }), { key: "ArrowDown" });
  await screen.findByRole("menuitem", { name: "Personal" });
  expect(screen.getByRole("menuitem", { name: "Create workspace" })).toBeTruthy();
  expect(screen.queryByRole("menuitem", { name: "Workspace settings" })).toBeNull();
});
