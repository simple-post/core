import {
  SCHEDULED_TIME_REQUIRED_MESSAGE,
  SCHEDULED_TIME_INVALID_MESSAGE,
  SCHEDULED_TIME_PAST_MESSAGE,
} from "@/lib/validations/scheduled-time";

import type { SourceCopy } from "./source-copy";

/** Only authored validation messages, never arbitrary server/provider text. */
export function scheduledTimeMessage(message: string, copy: SourceCopy): string {
  switch (message) {
    case SCHEDULED_TIME_REQUIRED_MESSAGE: {
      return copy("Choose a date and time before scheduling this post.");
    }
    case SCHEDULED_TIME_INVALID_MESSAGE: {
      return copy("Choose a valid date and time before scheduling this post.");
    }
    case SCHEDULED_TIME_PAST_MESSAGE: {
      return copy("Scheduled time must be in the future. Please choose a later date and time.");
    }
    default: {
      return message;
    }
  }
}
