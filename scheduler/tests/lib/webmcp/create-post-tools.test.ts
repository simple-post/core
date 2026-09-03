import { createPostTools, registerCreatePostTools, type WebMcpTool } from "@/lib/webmcp/create-post-tools";

const connected = [
  {
    id: "account-x",
    platform: "x",
    displayName: "Test",
    username: "test",
    accessToken: "secret",
    email: "private@example.com",
  },
];
const input = {
  message: "A test post",
  accountIds: ["account-x"],
  postingMode: "draft",
  userConfirmed: true,
  idempotencyKey: "test-post-1",
};
const saved = { post: { id: "post-1", status: "draft" }, postingResults: [] };

function setup() {
  const fetchMock = jest
    .fn()
    .mockImplementation(async (url: string) =>
      Response.json(url === "/api/v1/accounts" ? { accounts: connected } : saved),
    );
  const onCreated = jest.fn();
  const tools = createPostTools({ fetch: fetchMock, onCreated });
  const tool = (name: string) => tools.find((candidate) => candidate.name === name)!;
  return { fetchMock, onCreated, tools, tool };
}

describe("Create Post WebMCP tools", () => {
  it("exposes discoverable schemas for the complete creation workflow", () => {
    const { tools, tool } = setup();
    expect(tools.map((item) => item.name)).toEqual(["list_accounts", "validate_post", "create_post", "get_post"]);
    expect(tool("create_post").inputSchema.required).toEqual(
      expect.arrayContaining(["postingMode", "userConfirmed", "idempotencyKey"]),
    );
    expect(tool("create_post").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(tool("list_accounts").description).toContain("instead of clicking or filling the form");
  });

  it("lists only account identity and readiness, not credentials or email", async () => {
    const { tool, fetchMock } = setup();
    const result = await tool("list_accounts").execute({});
    expect(result).toMatchObject({
      accounts: [{ id: "account-x", platform: "x" }],
      currentTime: expect.any(String),
      timeZone: expect.any(String),
    });
    expect(JSON.stringify(result)).not.toMatch(/secret|private@example.com/);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/accounts",
      expect.objectContaining({ credentials: "same-origin", method: "GET" }),
    );
  });

  it("validates without creating a post or updating the UI", async () => {
    const { tool, fetchMock, onCreated } = setup();
    await tool("validate_post").execute({ message: "Check this", accountIds: ["account-x"] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/validation");
    expect(onCreated).not.toHaveBeenCalled();
  });

  it.each(["postingMode", "userConfirmed", "idempotencyKey"])(
    "rejects creation without %s before making requests",
    async (field) => {
      const { tool, fetchMock } = setup();
      const incomplete: Record<string, unknown> = { ...input };
      delete incomplete[field];
      await expect(tool("create_post").execute(incomplete)).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("rejects false authorization", async () => {
    const { tool, fetchMock } = setup();
    await expect(tool("create_post").execute({ ...input, userConfirmed: false })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, "2020-01-01T00:00:00Z", "2099-01-01T12:00:00"])(
    "rejects missing, past or timezone-less schedule: %s",
    async (scheduledFor) => {
      const { tool, fetchMock } = setup();
      await expect(tool("create_post").execute({ ...input, postingMode: "schedule", scheduledFor })).rejects.toThrow();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("normalizes an explicit timezone to the API's UTC format", async () => {
    const { tool, fetchMock } = setup();
    await tool("create_post").execute({ ...input, postingMode: "schedule", scheduledFor: "2099-01-01T12:00:00+02:00" });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.scheduledFor).toBe("2099-01-01T10:00:00.000Z");
    expect(body.userConfirmed).toBeUndefined();
    expect(body.idempotencyKey).toBe(input.idempotencyKey);
  });

  it("rejects account IDs that are not connected", async () => {
    const { tool, fetchMock } = setup();
    await expect(tool("create_post").execute({ ...input, accountIds: ["invented"] })).rejects.toThrow("not connected");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves media, threads and per-account versions in a direct create request", async () => {
    const { tool, fetchMock, onCreated } = setup();
    const result = await tool("create_post").execute({
      ...input,
      accountIds: ["account-x", "account-x"],
      media: [{ url: "https://example.com/image.png", type: "image", size: 123 }],
      thread: [{ message: "Follow up" }],
      accountOverrides: { "account-x": { message: "X version", media: [] } },
      accountOptions: { "account-x": { replyToId: "123" } },
    });
    expect(result).toEqual(saved);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({
      accountIds: ["account-x"],
      postingMode: "draft",
      accountOverrides: { "account-x": { message: "X version", media: [] } },
      accountOptions: { "account-x": { replyToId: "123" } },
      thread: [{ message: "Follow up" }],
      media: [{ id: expect.any(String), filename: "image.png", size: 123 }],
    });
    expect(onCreated).toHaveBeenCalledWith(saved);
  });

  it("rejects blob URLs instead of pretending local media can be published", async () => {
    const { tool, fetchMock } = setup();
    await expect(
      tool("create_post").execute({ ...input, media: [{ url: "blob:https://example.com/id", type: "image" }] }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("preserves TikTok's manual consent requirement but permits drafts", async () => {
    const { tool, fetchMock } = setup();
    fetchMock.mockImplementation(async (url: string) =>
      Response.json(url === "/api/v1/accounts" ? { accounts: [{ ...connected[0], platform: "tiktok" }] } : saved),
    );
    await expect(tool("create_post").execute({ ...input, postingMode: "now" })).rejects.toThrow("consent");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(tool("create_post").execute(input)).resolves.toEqual(saved);
  });

  it("surfaces authorization or billing errors without retrying", async () => {
    const { tool, fetchMock, onCreated } = setup();
    fetchMock.mockResolvedValueOnce(Response.json({ error: "Authentication required" }, { status: 401 }));
    await expect(tool("create_post").execute(input)).rejects.toThrow("Authentication required");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it("keeps idempotency keys on explicit retries and reports partial failures", async () => {
    const { tool, fetchMock } = setup();
    const failed = {
      post: { id: "post-1", status: "failed" },
      postingResults: [{ accountId: "account-x", success: false, error: "Provider rejected" }],
    };
    fetchMock.mockImplementation(async (url: string) =>
      Response.json(url === "/api/v1/accounts" ? { accounts: connected } : failed),
    );
    await tool("create_post").execute(input);
    expect(await tool("create_post").execute(input)).toEqual(failed);
    const writes = fetchMock.mock.calls.filter(([url]) => url === "/api/v1/posts");
    expect(writes.map(([, options]) => JSON.parse(options.body).idempotencyKey)).toEqual([
      input.idempotencyKey,
      input.idempotencyKey,
    ]);
  });

  it("does not hide a successful write if refreshing the page fails", async () => {
    const { tool, onCreated } = setup();
    onCreated.mockImplementation(() => {
      throw new Error("UI failed");
    });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(tool("create_post").execute(input)).resolves.toEqual(saved);
    } finally {
      warn.mockRestore();
    }
  });

  it("reads a post using an encoded ID without creating anything", async () => {
    const { tool, fetchMock } = setup();
    await tool("get_post").execute({ postId: "post/1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/posts/post%2F1", expect.objectContaining({ method: "GET" }));
  });

  it("registers every tool immediately with an abortable lifetime", async () => {
    const { tools } = setup();
    const signals: AbortSignal[] = [];
    const registerTool = jest.fn((_tool: WebMcpTool, options: { signal: AbortSignal }) => {
      signals.push(options.signal);
    });
    const controller = new AbortController();
    await registerCreatePostTools({ registerTool }, tools, controller.signal);
    expect(registerTool).toHaveBeenCalledTimes(4);
    controller.abort();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
