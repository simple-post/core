const authentication = require('./authentication');
const createPost = require('./creates/create-post');
const validatePost = require('./creates/validate-post');
const findAccount = require('./searches/find-account');
const accountList = require('./triggers/account-list');
const { newFailedPost, newPublishedPost } = require('./triggers/post-events');

module.exports = {
  version: require('./package.json').version,
  platformVersion: require('zapier-platform-core').version,
  // Keep empty strings and lists intact; the payload builders decide what to send.
  flags: { cleanInputData: false },
  authentication,
  triggers: {
    [newPublishedPost.key]: newPublishedPost,
    [newFailedPost.key]: newFailedPost,
    [accountList.key]: accountList,
  },
  searches: { [findAccount.key]: findAccount },
  creates: { [createPost.key]: createPost, [validatePost.key]: validatePost },
};
