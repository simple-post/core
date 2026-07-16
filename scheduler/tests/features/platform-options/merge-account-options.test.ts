import { mergeAccountOptions } from "@/features/platform-options/merge-account-options";

describe("mergeAccountOptions", () => {
  it("preserves earlier platform fields across rapid updates", () => {
    const withTitle = mergeAccountOptions({}, "pinterest-1", { title: "Pin title" });
    const withDescription = mergeAccountOptions(withTitle, "pinterest-1", {
      description: "Pin description",
    });

    expect(withDescription).toEqual({
      "pinterest-1": {
        title: "Pin title",
        description: "Pin description",
      },
    });
  });

  it("removes empty values without changing other account options", () => {
    const result = mergeAccountOptions(
      {
        "pinterest-1": { title: "Pin title", description: "Old description" },
        "youtube-1": { privacyStatus: "private" },
      },
      "pinterest-1",
      { description: "" },
    );

    expect(result).toEqual({
      "pinterest-1": { title: "Pin title" },
      "youtube-1": { privacyStatus: "private" },
    });
  });
});
