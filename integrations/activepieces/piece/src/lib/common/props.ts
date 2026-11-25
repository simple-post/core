import { Property } from '@activepieces/pieces-framework';

import { simplepostAuth } from '../auth';
import { ConnectedAccount, listAccounts } from './client';

const PLATFORM_LABELS: Record<string, string> = {
  bluesky: 'Bluesky',
  facebook: 'Facebook',
  forem: 'DEV / Forem',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
  telegram: 'Telegram',
  threads: 'Threads',
  tiktok: 'TikTok',
  twitter: 'X',
  x: 'X',
  youtube: 'YouTube',
};

export function accountLabel(account: ConnectedAccount): string {
  const name = account.displayName || (account.username ? `@${account.username}` : account.id);
  const platform = PLATFORM_LABELS[account.platform] ?? account.platform;
  const reconnect = account.credentialStatus?.state === 'reauth_required' ? ' (reconnect required)' : '';
  return `${name} (${platform})${reconnect}`;
}

export const accountIdsProperty = (description: string) =>
  Property.MultiSelectDropdown({
    auth: simplepostAuth,
    displayName: 'Accounts',
    description,
    required: true,
    refreshers: [],
    options: async ({ auth }) => {
      if (!auth) {
        return { disabled: true, placeholder: 'Connect your SimplePost account first.', options: [] };
      }

      const accounts = (await listAccounts(auth)).filter((account) => !account.previewOnly);
      if (accounts.length === 0) {
        return {
          disabled: true,
          placeholder: 'No social accounts found. Connect one in SimplePost first.',
          options: [],
        };
      }

      return {
        disabled: false,
        options: accounts.map((account) => ({ label: accountLabel(account), value: account.id })),
      };
    },
  });

export const messageProperty = () =>
  Property.LongText({
    displayName: 'Text',
    description: 'The post text. Leave empty only for media-only posts on platforms that allow it.',
    required: false,
  });

export const mediaProperty = () =>
  Property.Array({
    displayName: 'Media',
    description:
      'Images or videos to attach, in order. Use a public URL, or the URL returned by the **Upload Media** action. SimplePost copies external files into its own storage before publishing.',
    required: false,
    properties: {
      url: Property.ShortText({
        displayName: 'File URL',
        required: true,
        placeholder: 'https://example.com/photo.jpg',
      }),
      type: Property.StaticDropdown({
        displayName: 'Type',
        description: 'Leave empty to detect it from the file extension.',
        required: false,
        options: {
          disabled: false,
          options: [
            { label: 'Image', value: 'image' },
            { label: 'Video', value: 'video' },
          ],
        },
      }),
    },
  });

export const accountOptionsProperty = () =>
  Property.Json({
    displayName: 'Platform Settings',
    description:
      'Optional per-account platform settings keyed by account ID, e.g. `{ "<accountId>": { "title": "My video", "privacyStatus": "public" } }` for YouTube or `{ "<accountId>": { "boardId": "123" } }` for Pinterest.',
    required: false,
    advanced: true,
  });

export const accountOverridesProperty = () =>
  Property.Json({
    displayName: 'Per-Account Content',
    description:
      'Optional content that replaces the shared text, media, or thread for specific accounts, keyed by account ID, e.g. `{ "<accountId>": { "message": "Shorter text for X" } }`.',
    required: false,
    advanced: true,
  });

export const threadProperty = () =>
  Property.Array({
    displayName: 'Thread Replies',
    description:
      'Additional posts published as a thread under the first one on X, Bluesky, Threads, and Telegram. Up to 24 replies.',
    required: false,
    advanced: true,
  });
