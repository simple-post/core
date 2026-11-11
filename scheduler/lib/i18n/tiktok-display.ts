import type { TikTokPrivacyLevel } from "@/lib/tiktok/creator-info";

import type { SourceCopy } from "./source-copy";
export function privacyLabel(value: TikTokPrivacyLevel, copy: SourceCopy) {
  switch (value) {
    case "PUBLIC_TO_EVERYONE": {
      return copy("Everyone");
    }
    case "MUTUAL_FOLLOW_FRIENDS": {
      return copy("Friends");
    }
    case "FOLLOWER_OF_CREATOR": {
      return copy("Followers");
    }
    case "SELF_ONLY": {
      return copy("Only me");
    }
  }
}
