import { locales } from "@/lib/i18n/locales";
import { recoveryCopy, recoveryLocale } from "@/lib/i18n/recovery-copy";

it("keeps root-layout failure copy available independently in all locales", () => {
  expect(Object.keys(recoveryCopy).sort()).toEqual([...locales].sort());
  for (const locale of locales) expect(recoveryCopy[locale].every((value) => value.trim())).toBe(true);
});
it("uses a saved choice before browser languages, including manual English", () => {
  expect(recoveryLocale("ui_locale=en", ["bg-BG"])).toBe("en");
  expect(recoveryLocale("ui_locale=ja", ["bg-BG"])).toBe("ja");
  expect(recoveryLocale("", ["zh-TW", "en"])).toBe("zh-Hant");
  expect(recoveryLocale("ui_locale=%zz", ["bg-BG"])).toBe("bg");
});
