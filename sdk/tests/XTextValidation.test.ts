import { getXTextLength, validateXContent } from "../src/validation";

// The incident's 158-code-unit root post is 310 characters under X's rules.
const incident =
  "病院では「できないことをできるようにする」がゴールになりやすい。\n訪問では「今できていることを、この先も続けられるか」を見る。\n“何となく危ない”を拾い、困る前に環境やサービスを提案する。\n本人の希望と、専門職として予測する将来リスクをすり合わせる。\nゴール設定は「今」と「少し先の生活」を一緒に見ることから始まる。";

it.each([
  ["a".repeat(280), 280],
  ["日".repeat(140), 280],
  ["日".repeat(141), 282],
  ["👨‍👩‍👧‍👦", 2],
  ["👍🏽", 2],
  ["cafe\u0301", 4],
  ["https://example.com/" + "a".repeat(300), 23],
  ["example.com", 23],
  [incident, 310],
])("counts X text correctly: %s", (text, expected) => {
  expect(getXTextLength(text)).toBe(expected);
});

it("flags the incident during content validation, before any provider request", () => {
  expect(incident.length).toBe(158);
  expect(validateXContent({ text: incident }).warnings).toContainEqual(
    expect.objectContaining({ code: "long_post", actual: 310, limit: 280 }),
  );
});

it("accepts the exact Japanese standard limit and flags the next character", () => {
  expect(validateXContent({ text: "日".repeat(140) }).warnings).toEqual([]);
  expect(validateXContent({ text: "日".repeat(141) }).warnings).toContainEqual(
    expect.objectContaining({ code: "long_post", actual: 282 }),
  );
});

it("uses the same weighted count for the long-post ceiling", () => {
  expect(validateXContent({ text: "日".repeat(12_500) }).isValid).toBe(true);
  expect(validateXContent({ text: "日".repeat(12_501) }).errors).toContainEqual(
    expect.objectContaining({ code: "text_too_long", actual: 25_002, limit: 25_000 }),
  );
});

it("does not require Premium for long URL strings or compound emoji within the standard budget", () => {
  for (const text of ["a".repeat(256) + " https://example.com/" + "b".repeat(300), "👨‍👩‍👧‍👦".repeat(140)]) {
    expect(getXTextLength(text)).toBe(280);
    expect(validateXContent({ text }).warnings).toEqual([]);
  }
});
