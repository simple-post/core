import { validateXContent } from "../src/publishers/x/validation";

describe("X cashtag validation", () => {
  it.each(["$TOOF is live. Just $TOOF.", "$BTC $ETH", "$aapl\n$msft", "($BRK.B), $BTC!"])(
    "rejects multiple occurrences before publishing: %s",
    (text) => {
      expect(validateXContent({ text })).toMatchObject({
        isValid: false,
        errors: [{ code: "too_many_cashtags", field: "text", limit: 1, actual: 2 }],
      });
    },
  );
  it.each(["$TOOF is live. Just TOOF.", "$10 and $20", "hello", "$BRK.B", "$BTC https://example.com/$ETH"])(
    "accepts text with at most one cashtag: %s",
    (text) => expect(validateXContent({ text }).isValid).toBe(true),
  );
});
