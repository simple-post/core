import { formatTelegramLogNotification } from "@/lib/logger/telegram";

describe("Telegram log notifications", () => {
  it("promotes publishing identifiers, reason, trace, and content into the alert", () => {
    const notification = formatTelegramLogNotification({
      level: "error",
      message: "Platform post failed",
      timestamp: "2026-07-22T16:01:02.986Z",
      context: {
        module: "posting",
        userId: "user-123",
        userEmail: "vlad@example.com",
        userName: "Vlad",
        postId: "post-456",
        platform: "x",
        accountId: "account-789",
        accountUsername: "haltakov",
        accountHandle: "@haltakov",
        postingSource: "scheduler",
        traceId: "6128e02b4515227d45876ac3832a7307",
        contentPreview: "You’re not afraid of Mike Tyson.",
        contentLength: 247,
        message: "X images cannot exceed 5 MB. This file is 8.1 MB.",
        error: "INVALID_CONTENT",
      },
    });

    expect(notification).toContain("<b>User:</b> Vlad &lt;vlad@example.com&gt; (user-123)");
    expect(notification).toContain("<b>Post:</b> post-456");
    expect(notification).toContain("<b>Platform:</b> x");
    expect(notification).toContain("<b>Handle:</b> @haltakov");
    expect(notification).toContain("<b>Account ID:</b> account-789");
    expect(notification).toContain("<b>Trace:</b> <code>6128e02b4515227d45876ac3832a7307</code>");
    expect(notification).toContain("<b>Reason:</b> X images cannot exceed 5 MB. This file is 8.1 MB.");
    expect(notification).toContain("<b>Content (247 chars):</b> You’re not afraid of Mike Tyson.");
  });

  it("shows a readable account fallback when a provider has no handle", () => {
    const notification = formatTelegramLogNotification({
      level: "error",
      message: "Platform post failed",
      timestamp: "2026-07-23T10:00:00.000Z",
      context: {
        platform: "facebook",
        accountId: "account-123",
        accountUsername: "Creafex Lab",
      },
    });

    expect(notification).toContain("<b>Account:</b> Creafex Lab");
    expect(notification).toContain("<b>Account ID:</b> account-123");
    expect(notification).not.toContain("<b>Handle:</b>");
  });
});
