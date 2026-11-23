import { sendEmail } from "@/lib/resend";

const mockSend = jest.fn();
jest.mock("resend", () => ({ Resend: jest.fn(() => ({ emails: { send: mockSend } })) }));

beforeEach(() => mockSend.mockReset());

it("sends both HTML and plain-text email", async () => {
  mockSend.mockResolvedValue({ data: { id: "email-id" }, error: null });
  await sendEmail("user@example.invalid", "Code", "<p>123456</p>", "123456");
  expect(mockSend).toHaveBeenCalledWith(
    expect.objectContaining({ html: "<p>123456</p>", text: "123456", to: "user@example.invalid" }),
  );
});

it("rejects provider errors without leaking provider details", async () => {
  mockSend.mockResolvedValue({ data: null, error: { message: "Private provider details" } });
  await expect(sendEmail("user@example.invalid", "Code", "<p>123456</p>")).rejects.toThrow(
    "Failed to send sign-in email",
  );
});
