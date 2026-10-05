import { createAction } from '@activepieces/pieces-framework';
import { HttpMethod } from '@activepieces/pieces-common';

import { simplepostAuth } from '../auth';
import { simplepostRequest } from '../common/client';
import { buildPostContent } from '../common/post';
import {
  accountIdsProperty,
  accountOptionsProperty,
  accountOverridesProperty,
  mediaProperty,
  messageProperty,
  threadProperty,
} from '../common/props';

type ValidationIssue = {
  platform: string;
  severity?: string;
  code: string;
  message: string;
  field?: string;
};

type ValidationResponse = {
  summary: { isValid: boolean; errors: ValidationIssue[]; warnings: ValidationIssue[] };
  results?: { accountId: string; platform: string; isValid: boolean }[];
};

function flattenIssues(issues: ValidationIssue[]) {
  return issues.map((issue) => ({
    platform: issue.platform,
    code: issue.code,
    field: issue.field ?? null,
    message: issue.message,
  }));
}

export const validatePost = createAction({
  auth: simplepostAuth,
  name: 'validate_post',
  classification: 'READ',
  displayName: 'Validate Post',
  description: 'Check a post against each platform\'s rules without creating it.',
  audience: 'both',
  aiMetadata: {
    description:
      'Check text length, media, and thread rules for the selected SimplePost accounts without creating or publishing anything. Use before Create Post to catch problems; returns is_valid plus the errors and warnings per platform. Safe to retry.',
    idempotent: true,
  },
  props: {
    account_ids: accountIdsProperty('The social accounts to check the post against.'),
    message: messageProperty(),
    media: mediaProperty(),
    thread: threadProperty(),
    account_options: accountOptionsProperty(),
    account_overrides: accountOverridesProperty(),
  },
  outputSchema: {
    fields: [
      { key: 'is_valid', label: 'Valid', format: 'boolean' },
      {
        key: 'errors',
        label: 'Errors',
        labelKey: 'platform',
        listItems: [{ key: 'platform' }, { key: 'code' }, { key: 'field' }, { key: 'message' }],
      },
      {
        key: 'warnings',
        label: 'Warnings',
        labelKey: 'platform',
        listItems: [{ key: 'platform' }, { key: 'code' }, { key: 'field' }, { key: 'message' }],
      },
      {
        key: 'accounts',
        label: 'Accounts',
        labelKey: 'platform',
        listItems: [{ key: 'account_id' }, { key: 'platform' }, { key: 'is_valid', format: 'boolean' }],
      },
    ],
  },
  async run(context) {
    const response = await simplepostRequest<ValidationResponse>({
      auth: context.auth,
      method: HttpMethod.POST,
      path: '/api/v1/validation',
      body: buildPostContent(context.propsValue),
    });

    return {
      is_valid: response.summary.isValid,
      errors: flattenIssues(response.summary.errors),
      warnings: flattenIssues(response.summary.warnings),
      accounts: (response.results ?? []).map((result) => ({
        account_id: result.accountId,
        platform: result.platform,
        is_valid: result.isValid,
      })),
    };
  },
});
