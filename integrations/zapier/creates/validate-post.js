const { buildContentPayload, request } = require('../lib/simplepost');
const { accountIds, advancedFields, imageFit, mediaUrls, message, threadMessages } = require('./fields');

const toIssue = (issue) => ({
  platform: issue.platform,
  code: issue.code,
  field: issue.field || null,
  message: issue.message,
});

const issueOutputFields = (key, label) => [
  { key: `${key}[]platform`, label: `${label}: platform` },
  { key: `${key}[]code`, label: `${label}: code` },
  { key: `${key}[]field`, label: `${label}: field` },
  { key: `${key}[]message`, label: `${label}: message` },
];

module.exports = {
  key: 'validate_post',
  noun: 'Post',
  display: {
    label: 'Validate Post',
    description: 'Checks a post against each selected account\'s platform rules without saving or publishing it.',
  },
  operation: {
    inputFields: [accountIds, message, mediaUrls, imageFit, threadMessages, ...advancedFields],
    perform: async (z, bundle) => {
      const { summary } = await request(z, bundle, {
        method: 'POST',
        path: '/api/v1/validation',
        body: await buildContentPayload(z, bundle.inputData),
      });
      const errors = (summary?.errors || []).map(toIssue);
      const warnings = (summary?.warnings || []).map(toIssue);
      return {
        isValid: Boolean(summary?.isValid),
        errorCount: errors.length,
        warningCount: warnings.length,
        errorSummary: errors.map((issue) => issue.message).join(' '),
        errors,
        warnings,
      };
    },
    sample: {
      isValid: false,
      errorCount: 1,
      warningCount: 0,
      errorSummary: 'Instagram posts need at least one image or video.',
      errors: [
        { platform: 'instagram', code: 'media_required', field: 'media', message: 'Instagram posts need at least one image or video.' },
      ],
      warnings: [],
    },
    outputFields: [
      { key: 'isValid', label: 'Is valid', type: 'boolean' },
      { key: 'errorCount', label: 'Error count', type: 'integer' },
      { key: 'warningCount', label: 'Warning count', type: 'integer' },
      { key: 'errorSummary', label: 'Error summary' },
      ...issueOutputFields('errors', 'Errors'),
      ...issueOutputFields('warnings', 'Warnings'),
    ],
  },
};
