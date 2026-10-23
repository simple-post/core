// Input fields shared by Create Post and Validate Post. Required fields come
// first and the raw-JSON escape hatches for advanced API options come last.

const accountIds = {
  key: 'accountIds',
  label: 'Accounts',
  type: 'string',
  list: true,
  required: true,
  dynamic: 'account_list.id.name',
  helpText: 'Social accounts to post to. Connect accounts in SimplePost first.',
};

const message = {
  key: 'message',
  label: 'Message',
  type: 'text',
  required: false,
  helpText: 'Post text. Leave empty for a media-only post.',
};

const mediaUrls = {
  key: 'mediaUrls',
  label: 'Media',
  type: 'file',
  list: true,
  required: false,
  helpText: 'Images or videos to attach, as files from an earlier step or public URLs. SimplePost copies each file before publishing.',
};

const imageFit = {
  key: 'imageFit',
  label: 'Fit images',
  type: 'string',
  required: false,
  choices: [
    { value: 'blur', label: 'Pad with a blurred background', sample: 'blur' },
    { value: 'crop', label: 'Crop edges', sample: 'crop' },
  ],
  helpText: 'Resize images that do not meet a platform\'s size or aspect ratio rules. Leave empty to keep the originals.',
};

const threadMessages = {
  key: 'threadMessages',
  label: 'Thread replies',
  type: 'text',
  list: true,
  required: false,
  helpText: 'Additional posts that follow the message as a thread on X, Threads, Bluesky, and Telegram.',
};

const advancedFields = [
  {
    key: 'mediaJson',
    label: 'Media (JSON)',
    type: 'text',
    required: false,
    helpText: 'Advanced. A JSON array of SimplePost media objects with `id`, `url`, `type`, `filename`, and `size`. Added after the media above.',
  },
  {
    key: 'threadJson',
    label: 'Thread (JSON)',
    type: 'text',
    required: false,
    helpText: 'Advanced. A JSON array of thread segments such as `[{"message": "…", "media": []}]`. Added after the thread replies above.',
  },
  {
    key: 'accountOptionsJson',
    label: 'Account options (JSON)',
    type: 'text',
    required: false,
    helpText: 'Advanced. Platform options keyed by account ID, for example `{"<account ID>": {"title": "Video title", "privacyStatus": "public"}}`. See the [posting model](https://docs.simplepost.social/posting-model).',
  },
  {
    key: 'accountOverridesJson',
    label: 'Account overrides (JSON)',
    type: 'text',
    required: false,
    helpText: 'Advanced. Per-account `message`, `media`, or `thread` keyed by account ID, replacing the shared content for that account.',
  },
];

module.exports = { accountIds, advancedFields, imageFit, mediaUrls, message, threadMessages };
