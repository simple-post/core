const DEFAULT_BASE_URL = "https://app.simplepost.social";
const DOCS_URL = "https://docs.simplepost.social/api-reference";

const POSTING_MODES = [
  {
    label: "Publish now",
    value: "now",
  },
  {
    label: "Schedule for later",
    value: "schedule",
  },
  {
    label: "Save as draft",
    value: "draft",
  },
];

const IMAGE_FIT_OPTIONS = [
  {
    label: "Blur (keep the whole image over a blurred background)",
    value: "blur",
  },
  {
    label: "Crop (trim the edges)",
    value: "crop",
  },
];

const POST_LIST_TYPES = [
  "scheduled",
  "drafts",
  "past",
  "failed",
];

// Mirrors EXTENSION_TO_TYPE in @simple-post/sdk/media-types.
const EXTENSION_TO_CONTENT_TYPE = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

const WEBHOOK_EVENTS = {
  POST_PUBLISHED: "post.published",
  POST_FAILED: "post.failed",
};

// Deliveries signed more than this long ago are treated as replays.
const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

export default {
  DEFAULT_BASE_URL,
  DOCS_URL,
  POSTING_MODES,
  IMAGE_FIT_OPTIONS,
  POST_LIST_TYPES,
  EXTENSION_TO_CONTENT_TYPE,
  WEBHOOK_EVENTS,
  SIGNATURE_TOLERANCE_MS,
};
