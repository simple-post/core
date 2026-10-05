import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INode,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEFAULT_BASE_URL = 'https://app.simplepost.social';

// Webhook deliveries older than this are rejected to limit replay attacks.
export const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

export function normalizeBaseUrl(value: string | undefined): string {
	return (value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
}

export async function simplePostApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const credentials = await this.getCredentials('simplePostApi');
	const options: IHttpRequestOptions = {
		method,
		baseURL: normalizeBaseUrl(credentials.baseUrl as string | undefined),
		url: path,
		json: true,
	};

	if (body) options.body = body;
	if (qs) options.qs = qs;

	return (await this.helpers.httpRequestWithAuthentication.call(
		this,
		'simplePostApi',
		options,
	)) as IDataObject;
}

// The Scheduler API only accepts UTC `Z` timestamps, while n8n date pickers and
// Luxon expressions commonly produce offset or zone-less ISO strings.
export function normalizeScheduledFor(value: string, node: INode): string {
	const parsed = new Date(value);
	if (!value.trim() || Number.isNaN(parsed.getTime())) {
		throw new NodeOperationError(node, "The 'Scheduled For' value is not a valid date and time", {
			description: 'Use an ISO 8601 date and time, for example 2026-08-01T09:30:00+02:00',
		});
	}

	return parsed.toISOString();
}

function parseJson(value: string, fieldName: string, node: INode): unknown {
	try {
		return JSON.parse(value);
	} catch (error) {
		throw new NodeOperationError(node, `The '${fieldName}' value is not valid JSON`, {
			description: error instanceof Error ? error.message : undefined,
		});
	}
}

// n8n JSON parameters arrive as strings when typed and as objects when set
// through an expression, so both forms are accepted.
export function parseOptionalObject(
	value: unknown,
	fieldName: string,
	node: INode,
): IDataObject | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string' && !value.trim()) return undefined;

	const parsed = typeof value === 'string' ? parseJson(value, fieldName, node) : value;
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new NodeOperationError(node, `The '${fieldName}' value must be a JSON object`);
	}

	return parsed as IDataObject;
}

export function parseOptionalArray(
	value: unknown,
	fieldName: string,
	node: INode,
): IDataObject[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'string' && !value.trim()) return undefined;

	const parsed = typeof value === 'string' ? parseJson(value, fieldName, node) : value;
	if (
		!Array.isArray(parsed) ||
		parsed.some((item) => typeof item !== 'object' || item === null || Array.isArray(item))
	) {
		throw new NodeOperationError(node, `The '${fieldName}' value must be a JSON array of objects`);
	}

	return parsed as IDataObject[];
}

export function filenameFromUrl(url: string, type: string): string {
	const fallback = `simplepost-media.${type === 'video' ? 'mp4' : 'jpg'}`;
	try {
		return decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || fallback;
	} catch {
		return fallback;
	}
}

export function signWebhookBody(secret: string, timestamp: string, body: string): string {
	return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// Mirrors the Scheduler's `X-SimplePost-Signature: sha256=<hex>` scheme, where
// the HMAC covers `${timestamp}.${rawBody}`.
export function isValidWebhookSignature(
	secret: string,
	timestamp: string | undefined,
	signature: string | undefined,
	body: string,
	now = Date.now(),
): boolean {
	if (!timestamp || !signature?.startsWith('sha256=')) return false;

	const sentAt = Number(timestamp);
	if (!Number.isFinite(sentAt) || Math.abs(now - sentAt) > WEBHOOK_TOLERANCE_MS) return false;

	const expected = Buffer.from(signWebhookBody(secret, timestamp, body), 'hex');
	const received = Buffer.from(signature.slice('sha256='.length), 'hex');
	return expected.length === received.length && timingSafeEqual(expected, received);
}
