import { toMediaFiles, toThread } from './media';

export type PostContentInput = {
  account_ids: unknown[] | undefined;
  message?: string;
  media?: unknown[];
  thread?: unknown[];
  account_options?: unknown;
  account_overrides?: unknown;
};

function optionalObject(value: unknown, displayName: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${displayName} must be a JSON object keyed by account ID.`);
  }
  return Object.keys(value).length > 0 ? (value as Record<string, unknown>) : undefined;
}

// Builds the content fields shared by POST /api/v1/posts and
// POST /api/v1/validation, leaving out everything the user did not set.
export function buildPostContent(input: PostContentInput): Record<string, unknown> {
  const accountIds = (input.account_ids ?? []).filter((id): id is string => typeof id === 'string' && id !== '');
  if (accountIds.length === 0) {
    throw new Error('Select at least one account.');
  }

  const body: Record<string, unknown> = {
    message: input.message ?? '',
    accountIds,
  };
  const media = toMediaFiles(input.media);
  const thread = toThread(input.thread);
  const accountOptions = optionalObject(input.account_options, 'Platform Settings');
  const accountOverrides = optionalObject(input.account_overrides, 'Per-Account Content');

  if (media) body['media'] = media;
  if (thread) body['thread'] = thread;
  if (accountOptions) body['accountOptions'] = accountOptions;
  if (accountOverrides) body['accountOverrides'] = accountOverrides;
  return body;
}

// The Scheduler API accepts only UTC `Z` timestamps in the future.
export function normalizeScheduledFor(value: string | undefined, now: Date = new Date()): string {
  if (!value) {
    throw new Error('Choose a date and time in Scheduled For when Posting Mode is Schedule.');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Scheduled For must be a valid date and time, got "${value}".`);
  }
  if (parsed <= now) {
    throw new Error(`Scheduled For must be in the future, got ${parsed.toISOString()}.`);
  }
  return parsed.toISOString();
}
