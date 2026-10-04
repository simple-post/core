import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeProperties,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { randomUUID } from 'node:crypto';

import {
	filenameFromUrl,
	normalizeScheduledFor,
	parseOptionalArray,
	parseOptionalObject,
	simplePostApiRequest,
} from './shared';

type ConnectedAccount = {
	id: string;
	platform: string;
	displayName?: string | null;
	username?: string | null;
	previewOnly?: boolean;
	credentialStatus?: { state?: string } | null;
};

const postIdField: INodeProperties = {
	displayName: 'Post ID',
	name: 'postId',
	type: 'string',
	required: true,
	default: '',
	placeholder: 'e.g. cm9x2k7d40001',
	description: 'ID of the SimplePost post',
};

const postOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['post'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			description: 'Publish, schedule, or save a post as a draft',
			action: 'Create a post',
		},
		{
			name: 'Delete',
			value: 'delete',
			description: 'Delete a draft, scheduled, or past post from SimplePost',
			action: 'Delete a post',
		},
		{
			name: 'Get',
			value: 'get',
			description: 'Retrieve a post with its publishing results',
			action: 'Get a post',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'Retrieve a list of posts by status',
			action: 'Get many posts',
		},
	],
	default: 'create',
};

const accountOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['account'] } },
	options: [
		{
			name: 'Get Many',
			value: 'getAll',
			description: 'Retrieve the social accounts connected to SimplePost',
			action: 'Get many accounts',
		},
	],
	default: 'getAll',
};

const mediaOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['media'] } },
	options: [
		{
			name: 'Upload',
			value: 'upload',
			description: 'Upload an image or video from binary data for use in a post',
			action: 'Upload media',
		},
	],
	default: 'upload',
};

const createPostFields: INodeProperties[] = [
	{
		displayName: 'Account Names or IDs',
		name: 'accountIds',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'getAccounts' },
		required: true,
		default: [],
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
		description:
			'Connected SimplePost accounts to post to. Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	},
	{
		displayName: 'Message',
		name: 'message',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
		description: 'Text of the post. Leave empty for media-only posts.',
	},
	{
		displayName: 'Posting Mode',
		name: 'postingMode',
		type: 'options',
		options: [
			{ name: 'Publish Now', value: 'now', description: 'Publish to every account immediately' },
			{
				name: 'Save as Draft',
				value: 'draft',
				description: 'Keep the post in SimplePost for review',
			},
			{ name: 'Schedule', value: 'schedule', description: 'Publish at a future date and time' },
		],
		default: 'now',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
	},
	{
		displayName: 'Scheduled For',
		name: 'scheduledFor',
		type: 'dateTime',
		required: true,
		default: '',
		displayOptions: {
			show: { resource: ['post'], operation: ['create'], postingMode: ['schedule'] },
		},
		description: 'Future date and time when SimplePost publishes the post',
	},
	{
		displayName: 'Media',
		name: 'media',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Add Media',
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
		description:
			'Images or videos at public URLs, or the output of the Media Upload operation. SimplePost imports external files before publishing.',
		options: [
			{
				name: 'items',
				displayName: 'Media Item',
				values: [
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						required: true,
						default: '',
						placeholder: 'e.g. https://example.com/image.png',
					},
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
					{
						displayName: 'Filename',
						name: 'filename',
						type: 'string',
						default: '',
						description: 'Leave empty to use the last part of the URL',
					},
					{
						displayName: 'Thumbnail URL',
						name: 'thumbnailUrl',
						type: 'string',
						default: '',
						placeholder: 'e.g. https://example.com/thumbnail.png',
						description: 'Optional cover image for videos',
					},
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
		displayOptions: { show: { resource: ['post'], operation: ['create'] } },
		options: [
			{
				displayName: 'Account Options (JSON)',
				name: 'accountOptionsJson',
				type: 'json',
				default: '{}',
				description:
					'Platform-specific options keyed by account ID, such as YouTube title, privacy, or Pinterest board',
			},
			{
				displayName: 'Account Overrides (JSON)',
				name: 'accountOverridesJson',
				type: 'json',
				default: '{}',
				description: 'Per-account message, media, or thread keyed by account ID',
			},
			{
				displayName: 'Idempotency Key',
				name: 'idempotencyKey',
				type: 'string',
				default: '',
				description:
					'Stable unique value. Retrying with the same key returns the original post instead of publishing a duplicate.',
			},
			{
				displayName: 'Image Fit',
				name: 'imageFit',
				type: 'options',
				options: [
					{ name: 'Keep Original', value: '' },
					{ name: 'Crop', value: 'crop', description: 'Trim edges to fit each platform' },
					{
						name: 'Blur',
						value: 'blur',
						description: 'Keep the full image over a blurred background',
					},
				],
				default: '',
				description:
					'How to fit images that a platform would reject because of format, size, or aspect ratio. Requires image fitting on the SimplePost account.',
			},
			{
				displayName: 'Quote Post ID',
				name: 'quotePostId',
				type: 'string',
				default: '',
				description: 'ID of a published SimplePost post to quote',
			},
			{
				displayName: 'Repost',
				name: 'repostEnabled',
				type: 'boolean',
				default: false,
				description: 'Whether to repost automatically after publishing',
			},
			{
				displayName: 'Repost Delay (Hours)',
				name: 'repostDelayHours',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 720 },
				default: 12,
				description: 'Hours to wait before reposting when Repost is on',
			},
			{
				displayName: 'Thread (JSON)',
				name: 'threadJson',
				type: 'json',
				default: '[]',
				description:
					'Up to 24 additional thread segments after the main message, each with a message and optional media',
			},
		],
	},
];

const getManyPostFields: INodeProperties[] = [
	{
		displayName: 'Status',
		name: 'status',
		type: 'options',
		options: [
			{ name: 'Draft', value: 'drafts' },
			{ name: 'Failed', value: 'failed' },
			{ name: 'Published', value: 'past' },
			{ name: 'Scheduled', value: 'scheduled' },
		],
		default: 'scheduled',
		displayOptions: { show: { resource: ['post'], operation: ['getAll'] } },
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: ['post'], operation: ['getAll'] } },
		description: 'Whether to return all results or only up to a given limit',
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		displayOptions: { show: { resource: ['post'], operation: ['getAll'], returnAll: [false] } },
		description: 'Max number of results to return',
	},
];

export class SimplePost implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SimplePost',
		name: 'simplePost',
		icon: { light: 'file:simplePost.svg', dark: 'file:simplePost.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Publish, schedule, and draft social media posts with SimplePost',
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
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Media', value: 'media' },
					{ name: 'Post', value: 'post' },
				],
				default: 'post',
			},
			postOperations,
			accountOperations,
			mediaOperations,
			...createPostFields,
			{
				...postIdField,
				displayOptions: { show: { resource: ['post'], operation: ['get', 'delete'] } },
			},
			...getManyPostFields,
			{
				displayName: 'Input Binary Field',
				name: 'binaryPropertyName',
				type: 'string',
				required: true,
				default: 'data',
				displayOptions: { show: { resource: ['media'], operation: ['upload'] } },
				hint: 'The name of the input binary field containing the image or video',
			},
		],
	};

	methods = {
		loadOptions: {
			async getAccounts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await simplePostApiRequest.call(this, 'GET', '/api/v1/accounts');
				const accounts = (response.accounts as ConnectedAccount[] | undefined) ?? [];

				return accounts
					.filter((account) => !account.previewOnly)
					.map((account) => {
						const identity = account.displayName || account.username || account.id;
						const reconnect =
							account.credentialStatus?.state === 'reauth_required' ? ' – reconnect required' : '';
						return {
							name: `${identity} (${account.platform})${reconnect}`,
							value: account.id,
						};
					});
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				let results: IDataObject[];

				if (resource === 'post' && operation === 'create') {
					const response = await createPost.call(this, itemIndex);
					const post = response.post as IDataObject | undefined;
					// "Publish Now" returns 201 even when an account rejects the post,
					// so the outcome is read from the stored post status.
					if (post?.status === 'failed') {
						const message = `SimplePost could not publish the post: ${post.errorMessage ?? 'unknown reason'}`;
						if (this.continueOnFail()) {
							returnData.push({
								json: { error: message, ...response },
								pairedItem: { item: itemIndex },
							});
							continue;
						}
						throw new NodeOperationError(this.getNode(), message, {
							itemIndex,
							description:
								'Check the account results in the SimplePost app. Retrying with the same idempotency key returns this post instead of publishing again.',
						});
					}
					results = [response];
				} else if (resource === 'post' && operation === 'get') {
					const postId = this.getNodeParameter('postId', itemIndex) as string;
					const response = await simplePostApiRequest.call(
						this,
						'GET',
						`/api/v1/posts/${encodeURIComponent(postId)}`,
					);
					results = [response.post as IDataObject];
				} else if (resource === 'post' && operation === 'delete') {
					const postId = this.getNodeParameter('postId', itemIndex) as string;
					await simplePostApiRequest.call(
						this,
						'DELETE',
						`/api/v1/posts/${encodeURIComponent(postId)}`,
					);
					results = [{ deleted: true }];
				} else if (resource === 'post' && operation === 'getAll') {
					results = await getManyPosts.call(this, itemIndex);
				} else if (resource === 'account' && operation === 'getAll') {
					const response = await simplePostApiRequest.call(this, 'GET', '/api/v1/accounts');
					results = (response.accounts as IDataObject[] | undefined) ?? [];
				} else if (resource === 'media' && operation === 'upload') {
					results = [await uploadMedia.call(this, itemIndex)];
				} else {
					throw new NodeOperationError(
						this.getNode(),
						`The operation '${operation}' is not supported for '${resource}'`,
						{ itemIndex },
					);
				}

				returnData.push(
					...this.helpers.constructExecutionMetaData(this.helpers.returnJsonArray(results), {
						itemData: { item: itemIndex },
					}),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: error instanceof Error ? error.message : String(error) },
						pairedItem: { item: itemIndex },
					});
					continue;
				}

				// Both constructors return an already wrapped error unchanged, so the
				// item index is attached first.
				if (error instanceof NodeOperationError) {
					error.context.itemIndex ??= itemIndex;
					throw new NodeOperationError(this.getNode(), error, { itemIndex });
				}
				if (error instanceof NodeApiError) error.context.itemIndex ??= itemIndex;
				throw new NodeApiError(this.getNode(), error as JsonObject, { itemIndex });
			}
		}

		return [returnData];
	}
}

async function createPost(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const node = this.getNode();
	const postingMode = this.getNodeParameter('postingMode', itemIndex) as
		| 'now'
		| 'schedule'
		| 'draft';
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
			node,
		);
	}

	if (mediaCollection.items?.length) {
		body.media = mediaCollection.items.map((media) => {
			const url = String(media.url ?? '').trim();
			const type = media.type === 'video' ? 'video' : 'image';
			// Size is a hint only: the Scheduler imports and inspects every file.
			const item: IDataObject = {
				id: randomUUID(),
				url,
				type,
				filename: (media.filename as string) || filenameFromUrl(url, type),
				size: 0,
			};
			if (media.thumbnailUrl) item.thumbnailUrl = media.thumbnailUrl;
			return item;
		});
	}

	const accountOptions = parseOptionalObject(
		additionalFields.accountOptionsJson,
		'Account Options',
		node,
	);
	if (accountOptions && Object.keys(accountOptions).length) body.accountOptions = accountOptions;

	const accountOverrides = parseOptionalObject(
		additionalFields.accountOverridesJson,
		'Account Overrides',
		node,
	);
	if (accountOverrides && Object.keys(accountOverrides).length)
		body.accountOverrides = accountOverrides;

	const thread = parseOptionalArray(additionalFields.threadJson, 'Thread', node);
	if (thread?.length) body.thread = thread;

	if (additionalFields.repostEnabled === true) {
		body.repost = {
			enabled: true,
			delayHours: (additionalFields.repostDelayHours as number | undefined) ?? 12,
		};
	}

	if (additionalFields.imageFit) body.imageFit = additionalFields.imageFit;
	if (additionalFields.quotePostId) body.quotePostId = additionalFields.quotePostId;
	if (additionalFields.idempotencyKey) body.idempotencyKey = additionalFields.idempotencyKey;

	return await simplePostApiRequest.call(this, 'POST', '/api/v1/posts', body);
}

async function getManyPosts(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject[]> {
	const status = this.getNodeParameter('status', itemIndex) as string;
	const returnAll = this.getNodeParameter('returnAll', itemIndex) as boolean;
	const limit = returnAll ? Infinity : (this.getNodeParameter('limit', itemIndex) as number);
	const posts: IDataObject[] = [];

	for (let page = 1; posts.length < limit; page++) {
		const response = await simplePostApiRequest.call(this, 'GET', '/api/v1/posts', undefined, {
			type: status,
			page,
			limit: 100,
		});
		posts.push(...((response.posts as IDataObject[] | undefined) ?? []));
		const pagination = response.pagination as IDataObject | undefined;
		if (!pagination?.hasNextPage) break;
	}

	return posts.slice(0, limit);
}

async function uploadMedia(this: IExecuteFunctions, itemIndex: number): Promise<IDataObject> {
	const binaryPropertyName = this.getNodeParameter('binaryPropertyName', itemIndex) as string;
	const binaryData = this.helpers.assertBinaryData(itemIndex, binaryPropertyName);
	const buffer = await this.helpers.getBinaryDataBuffer(itemIndex, binaryPropertyName);
	const contentType = binaryData.mimeType;
	const filename =
		binaryData.fileName ||
		`simplepost-upload${binaryData.fileExtension ? `.${binaryData.fileExtension}` : ''}`;

	if (!contentType.startsWith('image/') && !contentType.startsWith('video/')) {
		throw new NodeOperationError(
			this.getNode(),
			`The binary field '${binaryPropertyName}' contains '${contentType}', not an image or video`,
			{ itemIndex, description: 'Pass an image or video file to the Media Upload operation' },
		);
	}

	const presigned = await simplePostApiRequest.call(this, 'POST', '/api/v1/upload/presign', {
		filename,
		contentType,
		size: buffer.length,
	});

	await this.helpers.httpRequest({
		method: 'PUT',
		url: presigned.uploadUrl as string,
		body: buffer,
		headers: { 'Content-Type': contentType },
	});

	return {
		id: randomUUID(),
		url: presigned.publicUrl,
		type: contentType.startsWith('video/') ? 'video' : 'image',
		filename,
		size: buffer.length,
	};
}
