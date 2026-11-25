import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { isValidWebhookSignature, simplePostApiRequest } from './shared';

type WebhookStaticData = {
	webhookId?: string;
	webhookSecret?: string;
	webhookUrl?: string;
};

type RegisteredWebhook = {
	id: string;
	url: string;
	events: string[];
};

function sameEvents(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((event) => b.includes(event));
}

export class SimplePostTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'SimplePost Trigger',
		name: 'simplePostTrigger',
		icon: { light: 'file:simplePost.svg', dark: 'file:simplePost.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when SimplePost publishes a post or a post fails',
		defaults: {
			name: 'SimplePost Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'simplePostApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: [
					{
						name: 'Post Failed',
						value: 'post.failed',
						description: 'Publishing failed on at least one account',
					},
					{
						name: 'Post Published',
						value: 'post.published',
						description: 'A post was published to every selected account',
					},
				],
				default: ['post.published', 'post.failed'],
			},
			{
				displayName:
					'SimplePost only delivers webhooks to public URLs. Use a public n8n URL or tunnel when testing a local instance.',
				name: 'publicUrlNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node') as WebhookStaticData;
				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = this.getNodeParameter('events') as string[];
				const response = await simplePostApiRequest.call(this, 'GET', '/api/v1/webhooks');
				const matching = ((response.webhooks as RegisteredWebhook[] | undefined) ?? []).filter(
					(webhook) => webhook.url === webhookUrl,
				);
				const existing = matching.find(
					(webhook) => webhook.id === webhookData.webhookId && sameEvents(webhook.events, events),
				);
				if (existing && webhookData.webhookSecret) return true;

				// SimplePost returns a signing secret only at creation. Replace stale
				// registrations for this callback URL, including after lost static data.
				for (const webhook of matching) {
					await simplePostApiRequest.call(this, 'DELETE', `/api/v1/webhooks/${webhook.id}`);
				}
				delete webhookData.webhookId;
				delete webhookData.webhookSecret;
				delete webhookData.webhookUrl;
				return false;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node') as WebhookStaticData;
				const response = await simplePostApiRequest.call(this, 'POST', '/api/v1/webhooks', {
					url: this.getNodeWebhookUrl('default'),
					events: this.getNodeParameter('events') as string[],
				});
				const webhook = response.webhook as IDataObject | undefined;

				if (!webhook?.id || !webhook.secret) {
					throw new NodeApiError(this.getNode(), response as JsonObject, {
						message: 'SimplePost did not return a webhook ID and signing secret',
					});
				}

				webhookData.webhookId = webhook.id as string;
				webhookData.webhookSecret = webhook.secret as string;
				webhookData.webhookUrl = this.getNodeWebhookUrl('default');
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node') as WebhookStaticData;
				if (
					webhookData.webhookId &&
					(!webhookData.webhookUrl || webhookData.webhookUrl === this.getNodeWebhookUrl('default'))
				) {
					try {
						await simplePostApiRequest.call(
							this,
							'DELETE',
							`/api/v1/webhooks/${webhookData.webhookId}`,
						);
					} catch (error) {
						// An endpoint already removed in SimplePost needs no cleanup.
						if ((error as { httpCode?: string }).httpCode !== '404') return false;
					}
				}

				delete webhookData.webhookId;
				delete webhookData.webhookSecret;
				delete webhookData.webhookUrl;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const webhookData = this.getWorkflowStaticData('node') as WebhookStaticData;
		const request = this.getRequestObject() as ReturnType<IWebhookFunctions['getRequestObject']> & {
			rawBody?: Buffer;
		};
		const headers = this.getHeaderData() as IDataObject;
		const rawBody = request.rawBody?.toString('utf8') ?? JSON.stringify(this.getBodyData());

		const isValid =
			webhookData.webhookSecret !== undefined &&
			isValidWebhookSignature(
				webhookData.webhookSecret,
				headers['x-simplepost-timestamp'] as string | undefined,
				headers['x-simplepost-signature'] as string | undefined,
				rawBody,
			);

		if (!isValid) {
			const response = this.getResponseObject();
			response.status(401).json({ message: 'Invalid SimplePost webhook signature' });
			return { noWebhookResponse: true };
		}

		const body = this.getBodyData();
		const events = this.getNodeParameter('events') as string[];
		if (typeof body.event !== 'string' || !events.includes(body.event)) {
			return { webhookResponse: 'ignored' };
		}

		return {
			workflowData: [this.helpers.returnJsonArray(body)],
		};
	}
}
