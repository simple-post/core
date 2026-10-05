const { listAccounts } = require('../lib/simplepost');

const outputFields = [
  { key: 'id', label: 'Account ID' },
  { key: 'name', label: 'Account name' },
  { key: 'platform', label: 'Platform' },
  { key: 'username', label: 'Username' },
  { key: 'displayName', label: 'Display name' },
  { key: 'needsReconnect', label: 'Needs reconnect', type: 'boolean' },
];

const sample = {
  id: 'cm0account123',
  name: 'SimplePost (@simplepost) · x',
  platform: 'x',
  username: 'simplepost',
  displayName: 'SimplePost',
  needsReconnect: false,
};

// Hidden trigger that powers the account dropdowns.
module.exports = {
  key: 'account_list',
  noun: 'Account',
  display: {
    label: 'New Connected Account',
    description: 'Triggers when a social account is connected to SimplePost.',
    hidden: true,
  },
  operation: {
    perform: listAccounts,
    sample,
    outputFields,
  },
};
