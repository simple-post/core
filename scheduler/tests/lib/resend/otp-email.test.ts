import { otpEmail } from "@/lib/resend/otp-email";

it("provides an unbroken six-digit code in the subject, HTML and plain text", () => {
  const message = otpEmail("012345", "sign-in");
  expect(message.subject).toBe("012345 is your SimplePost verification code");
  expect(message.html).toContain(">012345</p>");
  expect(message.text).toContain("Your SimplePost verification code is 012345.");
  expect(message.html).toContain("#c6f432");
  expect(message.html).toContain("10 minutes");
  expect(message.text).toContain("can only be used once");
});

it.each(["12345", "1234567", "<script>", "12 3456"])("rejects malformed code %s", (code) => {
  expect(() => otpEmail(code, "sign-in")).toThrow("six-digit");
});
