import { collectPostInput } from "../../src/lib/post/input.js";

describe("collectPostInput interactive mode", () => {
  it("shows only connected accounts and skips the review step", async () => {
    const prompt = {
      interactive: true,
      confirm: jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false),
      log: jest.fn(),
      multiSelect: jest.fn().mockResolvedValue(["account:x:main"]),
      text: jest.fn(async (message: string) => {
        switch (message) {
          case "Post text (optional)": {
            return "Hello world";
          }
          default: {
            return "";
          }
        }
      }),
    } as any;

    const result = await collectPostInput(
      {
        interactive: true,
      },
      prompt,
      {
        accounts: [
          {
            alias: "main",
            displayName: "Alice",
            platform: "x",
            source: "local",
            username: "alice",
          },
        ],
      },
    );

    expect(prompt.multiSelect).toHaveBeenCalledWith(
      "Which connected accounts should receive this post?",
      [
        expect.objectContaining({
          group: "Connected accounts",
          label: "X · main",
          value: "account:x:main",
        }),
      ],
      expect.objectContaining({ minSelections: 1 }),
    );
    expect(prompt.multiSelect.mock.invocationCallOrder[0]).toBeLessThan(prompt.text.mock.invocationCallOrder[0]);
    expect(result.accountSelections).toEqual({ x: ["main"] });
    expect(result.post.platforms).toEqual(["x"]);
    expect(result.post.content.text).toBe("Hello world");
    expect(prompt.select).toBeUndefined();
    expect(prompt.text).not.toHaveBeenCalledWith(expect.stringContaining("Log level"), expect.anything());
    expect(prompt.text).not.toHaveBeenCalledWith(expect.stringContaining("Strict mode"), expect.anything());
  });
});
