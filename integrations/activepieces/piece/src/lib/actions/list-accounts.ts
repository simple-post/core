import { createAction } from '@activepieces/pieces-framework';

import { simplepostAuth } from '../auth';
import { listAccounts as fetchAccounts } from '../common/client';
import { accountLabel } from '../common/props';

export const listAccounts = createAction({
  auth: simplepostAuth,
  name: 'list_accounts',
  classification: 'SEARCH',
  displayName: 'List Accounts',
  description: 'List the social accounts connected to SimplePost.',
  audience: 'both',
  aiMetadata: {
    description:
      'List every social account connected to SimplePost with its ID, platform, handle, and whether it needs to be reconnected. Use it to find the account IDs that Create Post and Validate Post expect. Safe to retry.',
    idempotent: true,
  },
  props: {},
  outputSchema: {
    itemLabel: '{name}',
    fields: [
      { key: 'account_id', label: 'Account ID' },
      { key: 'name', label: 'Name' },
      { key: 'platform', label: 'Platform' },
      { key: 'username', label: 'Username' },
      { key: 'can_publish', label: 'Can Publish', format: 'boolean' },
      { key: 'needs_reconnect', label: 'Needs Reconnect', format: 'boolean' },
    ],
  },
  async run(context) {
    const accounts = await fetchAccounts(context.auth);
    return accounts.map((account) => ({
      account_id: account.id,
      name: accountLabel(account),
      platform: account.platform,
      username: account.username ?? null,
      display_name: account.displayName ?? null,
      can_publish: account.previewOnly !== true,
      needs_reconnect: account.credentialStatus?.state === 'reauth_required',
    }));
  },
});
