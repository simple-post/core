import { applicationSdk } from "./app-sdk.js";
import { catalog } from "./catalog.js";
import { platforms } from "./types.js";

// Gaps stay visible in plans/reports. A newly added SDK option must receive either a scenario
// or an explicit classification; schema growth must not silently shrink acceptance coverage.
const gaps: Record<string, string> = {
  "facebook.publishAt":
    "Platform-native scheduling needs a separate owner scheduled-post verifier; SimplePost scheduling is covered.",
  "youtube.publishAt":
    "Platform-native private-to-public transition is not yet covered by the live scheduler scenarios.",
  "youtube.playlistId":
    "YouTube playlist publishing is paused because it needs unapproved OAuth scopes; the catalog scenario remains retained for coverage.",
  "youtube.thumbnailPath":
    "Custom thumbnail content is covered through URL input and the UI file picker; this local CLI option variant remains untested live.",
  "tiktok.visibility": "Legacy audience alias; live cases exercise explicit privacyLevel values.",
  "bluesky.replyTo": "Thread chaining is covered; direct nested root/parent input remains untested live.",
};
const defaults: Record<string, string[]> = {
  "telegram.chatId": ["telegram.smoke"],
  "pinterest.boardId": ["pinterest.smoke"],
};
export function optionCoverage() {
  const { PostOptionsSchema } = applicationSdk();
  return platforms.flatMap((platform) => {
    const shape = PostOptionsSchema.shape[platform].unwrap().shape;
    return Object.keys(shape).map((option) => {
      const key = `${platform}.${option}`;
      const definitions = catalog.filter((s) => s.platform === platform && Object.hasOwn(s.options, option));
      const scenarios = definitions.map((s) => s.id);
      scenarios.push(...(defaults[key] ?? []));
      return {
        key,
        status:
          option === "credentials"
            ? "account-setup"
            : scenarios.length
              ? "scenario"
              : gaps[key]
                ? "gap"
                : "unclassified",
        scenarios,
        reason: gaps[key] ?? definitions.find((s) => s.unsupportedReason)?.unsupportedReason,
      };
    });
  });
}
