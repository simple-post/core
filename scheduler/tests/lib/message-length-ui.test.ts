import { getMainFieldCharCounterState } from "@/lib/message-length-ui";

const xRow = { platform: "x", rules: { text: { maxLength: 25_000, standardMaxLength: 280 } } };

it("shows X's weighted count and long-post hint for Japanese text", () => {
  expect(
    getMainFieldCharCounterState({
      message: "日".repeat(141),
      maxTextLength: 25_000,
      validationResults: [xRow],
      requireXCommonContent: true,
    }),
  ).toMatchObject({ numerator: 282, denominator: 25_000, showLongPostOnXHint: true });
});

it("counts URL shortening before showing the X limit", () => {
  expect(
    getMainFieldCharCounterState({
      message: "https://example.com/" + "a".repeat(300),
      maxTextLength: 25_000,
      validationResults: [xRow],
      requireXCommonContent: true,
    }),
  ).toMatchObject({ numerator: 23, denominator: 280, showLongPostOnXHint: false });
});

it("leaves the shared counter unweighted when X uses an override", () => {
  expect(
    getMainFieldCharCounterState({
      message: "日".repeat(141),
      maxTextLength: 500,
      validationResults: [{ ...xRow, usesCommonContent: false }],
      requireXCommonContent: true,
    }),
  ).toMatchObject({ numerator: 141, denominator: 500, showLongPostOnXHint: false });
});
