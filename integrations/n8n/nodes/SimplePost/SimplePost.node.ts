import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { randomUUID } from 'node:crypto';

import { normalizeBaseUrl, normalizeScheduledFor, parseOptionalArray, parseOptionalObject } from './shared';

type ConnectedAccount = {
	id: string;
	platform: string;
	displayName?: string | null;
	username?: string | null;
};

type AccountsResponse = {
	accounts: ConnectedAccount[];
};

async function simplePostRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions,
	method: 'GET' | 'POST',
	path: string,
	body?: IDataObject,
): Promise<unknown> {
	const credentials = await this.getCredentials('simplePostApi');
	const options: IHttpRequestOptions = {
		method,
		baseURL: normalizeBaseUrl(credentials.baseUrl as string),
		url: path,
		json: true,
	};

	if (body) options.body = body;

	return await this.helpers.httpRequestWithAuthentication.call(this, 'simplePostApi', options);
}

export class SimplePost implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SimplePost',
		name: 'simplePost',
		icon: { light: 'file:simplePost.svg', dark: 'file:simplePost.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["postingMode"] === "now" ? "Publish now" : $parameter["postingMode"] === "schedule" ? "Schedule" : "Save draft"}}',
		description: 'Publish and schedule social media posts with SimplePost',
		defaults: {
			name: 'SimplePost',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'simplePostApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'hidden',
				default: 'post',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'hidden',
				default: 'create',
			},
			{
				displayName: 'Message',
				name: 'message',
				type: 'string',
				typeOptions: { rows: 5 },
				default: '',
				description: 'The root post text. It may be empty for media-only posts.',
			},
			{
				displayName: 'Account Names or IDs',
				name: 'accountIds',
				type: 'multiOptions',
				typeOptions: {
					loadOptionsMethod: 'getAccounts',
				},
				default: [],
				required: true,
				description: 'Connected SimplePost accounts to publish to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Posting Mode',
				name: 'postingMode',
				type: 'options',
				options: [
					{ name: 'Publish Now', value: 'now', action: 'Publish a post now' },
					{ name: 'Save as Draft', value: 'draft', action: 'Save a post as a draft' },
					{ name: 'Schedule', value: 'schedule', action: 'Schedule a post' },
				],
				default: 'now',
			},
			{
				displayName: 'Scheduled For',
				name: 'scheduledFor',
				type: 'dateTime',
				default: '',
				required: true,
				displayOptions: {
					show: { postingMode: ['schedule'] },
				},
				description: 'Date and time when SimplePost should publish the post',
			},
			{
				displayName: 'Media',
				name: 'media',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				placeholder: 'Add Media',
				description: 'Publicly reachable image or video metadata, matching the SimplePost API media object',
				options: [
					{
						name: 'items',
						displayName: 'Media Item',
						values: [
							{
								displayName: 'Duration (Seconds)',
								name: 'durationSec',
								type: 'number',
								typeOptions: { minValue: 0 },
								default: 0,
							},
							{
								displayName: 'Filename',
								name: 'filename',
								type: 'string',
								default: '',
								description: 'Optional filename. When omitted, the node derives it from the URL.',
							},
							{
								displayName: 'ID',
								name: 'id',
								type: 'string',
								default: '',
								description: 'Optional media ID. The node generates one when omitted.',
							},
							{
								displayName: 'Size in Bytes',
								name: 'size',
								type: 'number',
								typeOptions: { minValue: 0 },
								default: 0,
								description: 'Optional size used for platform validation, when known',
							},
							{ displayName: 'Thumbnail URL', name: 'thumbnailUrl', type: 'string', default: '' },
							{
								displayName: 'Type',
								name: 'type',
								type: 'options',
								options: [
									{ name: 'Image', value: 'image' },
									{ name: 'Video', value: 'video' },
								],
								default: 'image',
							},
							{ displayName: 'URL', name: 'url', type: 'string', default: '', required: true },
						],
					},
				],
			},
			{
				displayName: 'Additional Fields',
				name: 'additionalFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				options: [
					{
						displayName: 'Account Options (JSON)',
						name: 'accountOptionsJson',
						type: 'json',
						default: '',
						description: 'Platform-specific options keyed by account ID, such as privacy, board, playlist, tags, title, or reply settings',
					},
					{
						displayName: 'Account Overrides (JSON)',
						name: 'accountOverridesJson',
						type: 'json',
						default: '',
						description: 'Per-account message, media, or thread overrides keyed by account ID',
					},
					{
						displayName: 'Idempotency Key',
						name: 'idempotencyKey',
						type: 'string',
						default: '',
						description: 'A stable unique value that prevents a retried workflow execution from creating a duplicate post',
					},
					{
						displayName: 'Quote Post ID',
						name: 'quotePostId',
						type: 'string',
						default: '',
						description: 'ID of an existing SimplePost post to quote',
					},
					{
						displayName: 'Repost',
						name: 'repostEnabled',
						type: 'boolean',
						default: false,
						description: 'Whether to automatically repost after publishing',
					},
					{
						displayName: 'Repost Delay (Hours)',
						name: 'repostDelayHours',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 720 },
						default: 12,
					},
					{
						displayName: 'Thread (JSON)',
						name: 'threadJson',
						type: 'json',
						default: '',
						description: 'Array of up to 24 additional thread segments. Each item accepts message and optional media.',
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = (await simplePostRequest.call(this, 'GET', '/api/v1/accounts')) as AccountsResponse;
				return response.accounts.map((account) => {
					const identity = account.displayName || account.username || account.id;
					return {
						name: `${identity} (${account.platform})`,
						value: account.id,
					};
				});
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const postingMode = this.getNodeParameter('postingMode', itemIndex) as 'now' | 'schedule' | 'draft';
				const mediaCollection = this.getNodeParameter('media', itemIndex, {}) as {
					items?: IDataObject[];
				};
				const additionalFields = this.getNodeParameter('additionalFields', itemIndex, {}) as IDataObject;
				const body: IDataObject = {
					message: this.getNodeParameter('message', itemIndex, '') as string,
					accountIds: this.getNodeParameter('accountIds', itemIndex) as string[],
					postingMode,
				};

				if (postingMode === 'schedule') {
					body.scheduledFor = normalizeScheduledFor(
						this.getNodeParameter('scheduledFor', itemIndex) as string,
						() => this.getNode(),
					);
				}

				if (mediaCollection.items?.length) {
					body.media = mediaCollection.items.map((media) => {
						const normalized = { ...media };
						const url = normalized.url as string;
						normalized.id ||= randomUUID();
						normalized.filename ||=
							url.split('/').pop()?.split('?')[0] || `simplepost-media.${normalized.type === 'video' ? 'mp4' : 'jpg'}`;
						if (!normalized.thumbnailUrl) delete normalized.thumbnailUrl;
						if (!normalized.durationSec) delete normalized.durationSec;
						return normalized;
					});
				}

				const accountOptions = parseOptionalObject(
					(additionalFields.accountOptionsJson as string | undefined) ?? '',
					'Account Options',
					() => this.getNode(),
				);
				if (accountOptions) body.accountOptions = accountOptions;

				const accountOverrides = parseOptionalObject(
					(additionalFields.accountOverridesJson as string | undefined) ?? '',
					'Account Overrides',
					() => this.getNode(),
				);
				if (accountOverrides) body.accountOverrides = accountOverrides;

				const thread = parseOptionalArray(
					(additionalFields.threadJson as string | undefined) ?? '',
					'Thread',
					() => this.getNode(),
				);
				if (thread) body.thread = thread;

				if (additionalFields.repostEnabled === true) {
					body.repost = {
						enabled: true,
						delayHours: (additionalFields.repostDelayHours as number | undefined) ?? 12,
					};
				}

				if (additionalFields.quotePostId) body.quotePostId = additionalFields.quotePostId;
				if (additionalFields.idempotencyKey) body.idempotencyKey = additionalFields.idempotencyKey;

				const response = (await simplePostRequest.call(this, 'POST', '/api/v1/posts', body)) as IDataObject;
				output.push({ json: response, pairedItem: { item: itemIndex } });
			} catch (error) {
				if (this.continueOnFail()) {
					output.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				if (error instanceof NodeOperationError) {
					throw new NodeOperationError(this.getNode(), error, { itemIndex });
				}
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}
		}

		return [output];
	}
}
