import React from "react";

import { renderToStaticMarkup } from "react-dom/server";

import { CreatePostWebMcp, WebMcpProvider } from "@/components/create-post-webmcp";
import type { ModelContext, WebMcpTool } from "@/lib/webmcp/create-post-tools";

const invalidateQueries = jest.fn().mockResolvedValue(undefined);
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
jest.mock("@/lib/query-client", () => ({
  queryKeys: { billing: ["billing"], onboarding: ["onboarding"] },
}));

describe("App-wide WebMCP provider and instructions", () => {
  let effect: React.EffectCallback;
  let cleanup: (() => void) | undefined;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(React, "useEffect").mockImplementation((callback) => {
      effect = callback;
    });
    Object.defineProperty(globalThis, "document", { configurable: true, value: {} });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    jest.restoreAllMocks();
    for (const [name, descriptor] of [
      ["document", originalDocument],
      ["navigator", originalNavigator],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });

  function mountProvider() {
    const html = renderToStaticMarkup(React.createElement(WebMcpProvider, { children: "Any signed-in page" }));
    cleanup = effect() || undefined;
    return html;
  }

  it.each(["document", "navigator"] as const)(
    "registers all tools through %s without an instructions banner",
    (surface) => {
      const registerTool = jest.fn();
      Object.defineProperty(globalThis, surface, {
        configurable: true,
        value: { modelContext: { registerTool } satisfies ModelContext },
      });

      expect(mountProvider()).toBe("Any signed-in page");
      expect(registerTool.mock.calls.map(([tool]: [WebMcpTool]) => tool.name)).toEqual([
        "list_accounts",
        "validate_post",
        "create_post",
        "get_post",
      ]);
      const signal = registerTool.mock.calls[0][1].signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      cleanup?.();
      expect(signal.aborted).toBe(true);
    },
  );

  it("leaves the app usable in browsers without WebMCP", () => {
    expect(mountProvider()).toBe("Any signed-in page");
    expect(cleanup).toBeUndefined();
  });

  it("refreshes dashboard posts and counters after a tool creates a post", async () => {
    const registerTool = jest.fn();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { modelContext: { registerTool } },
    });
    jest
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (url) =>
        Response.json(
          url === "/api/v1/accounts"
            ? { accounts: [{ id: "account-x", platform: "x" }] }
            : { post: { id: "post-1", status: "draft" } },
        ),
      );
    mountProvider();
    const create = registerTool.mock.calls.find(
      ([tool]: [WebMcpTool]) => tool.name === "create_post",
    )![0] as WebMcpTool;
    await create.execute({
      message: "A draft",
      accountIds: ["account-x"],
      postingMode: "draft",
      userConfirmed: true,
      idempotencyKey: "provider-test-1",
    });
    expect(invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["posts"] }],
      [{ queryKey: ["billing"] }],
      [{ queryKey: ["onboarding"] }],
    ]);
  });

  it("shows only a small, collapsed instructions button by default", () => {
    const html = renderToStaticMarkup(React.createElement(CreatePostWebMcp));
    expect(html).toContain("AI agent instructions");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("WebMCP tools for agents");
    expect(html).not.toContain("list_accounts");
  });

  it("reveals the instructions when expanded without mounting another provider", () => {
    function ExpandedInstructions() {
      return React.cloneElement(CreatePostWebMcp(), { open: true });
    }
    const html = renderToStaticMarkup(React.createElement(ExpandedInstructions));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("WebMCP tools for agents");
    expect(html).toContain("list_accounts");
    expect(html).toContain("validate_post");
    expect(html).toContain("create_post");
    expect(html).toContain("get_post");
  });
});
