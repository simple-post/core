const { listAccounts } = require('../lib/simplepost');

module.exports = {
  key: 'find_account',
  noun: 'Account',
  display: {
    label: 'Find Account',
    description: 'Finds a social account connected to SimplePost by name, username, or platform.',
  },
  operation: {
    inputFields: [
      {
        key: 'query',
        label: 'Name, username, or platform',
        type: 'string',
        required: true,
        helpText: 'Matches any part of the account name, @username, or platform, such as `instagram`.',
      },
    ],
    perform: async (z, bundle) => {
      const query = String(bundle.inputData.query || '').trim().toLowerCase().replace(/^@/, '');
      if (!query) throw new z.errors.Error('Enter an account name, ID, username, or platform.', 'MissingAccountQuery', 400);
      const accounts = await listAccounts(z, bundle);
      const fields = (account) => [account.id, account.username, account.displayName, account.platform]
        .filter(Boolean).map((value) => String(value).toLowerCase().replace(/^@/, ''));
      const exact = accounts.filter((account) => fields(account).includes(query));
      if (exact.length > 0) return exact;
      return accounts.filter((account) => fields(account).some((value) => value.includes(query)));
    },
    sample: {
      id: 'cm0account123',
      name: 'SimplePost (@simplepost) · x',
      platform: 'x',
      username: 'simplepost',
      displayName: 'SimplePost',
      needsReconnect: false,
    },
    outputFields: [
      { key: 'id', label: 'Account ID' },
      { key: 'name', label: 'Account name' },
      { key: 'platform', label: 'Platform' },
      { key: 'username', label: 'Username' },
      { key: 'displayName', label: 'Display name' },
      { key: 'needsReconnect', label: 'Needs reconnect', type: 'boolean' },
    ],
  },
};
