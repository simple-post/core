import { renderDisconnectEmail } from "@/lib/notifications/disconnect-email";

const input = {
  platformName: "Instagram",
  accountLabel: "@dunkelrot.de",
  affectedQueuedPosts: 3,
  appUrl: "https://app.simplepost.social",
};
it("leads with reconnecting, provides actionable instructions and a plain-text alternative", () => {
  const email = renderDisconnectEmail(input);
  expect(email.subject).toBe("Reconnect your Instagram account in SimplePost");
  expect(email.text).toContain("Your Instagram account @dunkelrot.de needs reconnecting in SimplePost.");
  expect(email.text).toContain("3 queued posts need this connection");
  expect(email.html).toContain('href="https://app.simplepost.social/accounts"');
  expect(email.html).toContain('src="https://app.simplepost.social/simplepost-logo.png"');
  expect(email.text).toContain("failed posts must be rescheduled separately");
  expect(email.text).not.toContain("sorry");
});
it.each([0, 1])("handles %s queued targets without inventing failed-post counts", (affectedQueuedPosts) => {
  const email = renderDisconnectEmail({ ...input, platformName: "LinkedIn", accountLabel: null, affectedQueuedPosts });
  expect(email.text).toContain(
    affectedQueuedPosts ? "1 queued post needs this connection" : "Reconnect before publishing",
  );
  expect(email.text).not.toContain("three failed");
  expect(email.subject).toContain("LinkedIn");
});
it("escapes untrusted profile fields and rejects non-web links", () => {
  const email = renderDisconnectEmail({
    ...input,
    accountLabel: '<img src=x onerror="evil()">',
    platformName: "Instagram\r\nBcc: injected",
  });
  expect(email.html).not.toContain('<img src=x onerror="evil()">');
  expect(email.html).toContain("&lt;img");
  expect(email.subject).not.toContain("\n");
  expect(() => renderDisconnectEmail({ ...input, appUrl: "javascript:alert(1)" })).toThrow();
});
it("uses the configured application origin for both reconnect links and the brand logo", () => {
  const email = renderDisconnectEmail({ ...input, appUrl: "https://scheduler.example.com/other/path" });
  expect(email.html).toContain('href="https://scheduler.example.com/accounts"');
  expect(email.html).toContain('src="https://scheduler.example.com/simplepost-logo.png"');
});
