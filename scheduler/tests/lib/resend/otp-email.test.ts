import { localeFromRequestHeaders } from "@/lib/i18n/locales";
import arabic from "@/lib/i18n/messages/ar.json";
import { otpEmail } from "@/lib/resend/otp-email";

it("provides an unbroken six-digit code in the subject, HTML and plain text", () => {
  const message = otpEmail("012345", "sign-in", "https://app.simplepost.social");
  expect(message.subject).toBe("012345 is your SimplePost verification code");
  expect(message.html).toContain(">012345</p>");
  expect(message.text).toContain("Your SimplePost verification code is 012345.");
  expect(message.html).toContain("#c6f432");
  expect(message.html).toContain("10 minutes");
  expect(message.text).toContain("can only be used once");
});

it.each(["12345", "1234567", "<script>", "12 3456"])("rejects malformed code %s", (code) => {
  expect(() => otpEmail(code, "sign-in", "https://app.simplepost.social")).toThrow("six-digit");
});

it("uses the preferred language and direction while preserving the exact code", () => {
  const locale = localeFromRequestHeaders(new Headers({ cookie: "ui_locale=ar", "accept-language": "en-US" }));
  const message = otpEmail("012345", "sign-in", "https://app.simplepost.social", locale, arabic);
  expect(message.html).toContain('<html lang="ar" dir="rtl">');
  expect(message.html).toMatch(/<p dir="ltr"[^>]*>012345<\/p>/);
  expect(message.subject).toBe("رمز التحقق من SimplePost هو 012345");
  expect(message.text).toContain("012345");
});
