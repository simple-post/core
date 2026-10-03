import { EmailDeliveryError, sendNotificationEmail } from "@/lib/resend/notification-email";

const message = {
  from: "SimplePost <auth@example.invalid>",
  to: "owner@example.invalid",
  subject: "Reconnect",
  html: "<p>Reconnect</p>",
  text: "Reconnect",
};
const fetchMock = jest.fn();
const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterAll(() => {
  global.fetch = originalFetch;
});
it("uses bounded requests and identical request bytes even after JSONB key reordering", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "provider-id" }) });
  expect(await sendNotificationEmail(message, "episode-1")).toBe("provider-id");
  await sendNotificationEmail(
    { text: message.text, subject: message.subject, to: message.to, html: message.html, from: message.from },
    "episode-1",
  );
  expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body);
  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.resend.com/emails",
    expect.objectContaining({
      headers: expect.objectContaining({ "Idempotency-Key": "episode-1" }),
      signal: expect.any(AbortSignal),
      redirect: "error",
    }),
  );
});
it("does not incorporate provider errors or secrets in the exception", async () => {
  const json = jest.fn(async () => ({ message: "SECRET recipient and key" }));
  fetchMock.mockResolvedValue({ ok: false, status: 429, json });
  await expect(sendNotificationEmail(message, "episode-1")).rejects.toEqual(new EmailDeliveryError(429));
  expect(json).not.toHaveBeenCalled();
});
it("does not mark an ambiguous successful response as accepted without a message ID", async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  await expect(sendNotificationEmail(message, "episode-1")).rejects.toThrow("message ID");
});
it("aborts a stalled email request after ten seconds", async () => {
  jest.useFakeTimers();
  try {
    fetchMock.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")))),
    );
    const timeout = jest.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const pending = sendNotificationEmail(message, "episode-1");
    const assertion = expect(pending).rejects.toThrow("timeout");
    expect(timeout).toHaveBeenCalledWith(10_000);
    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;
    timeout.mockRestore();
  } finally {
    jest.useRealTimers();
  }
});
