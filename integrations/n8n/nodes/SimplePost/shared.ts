import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, '');
}

export function parseOptionalObject(
	value: string,
	fieldName: string,
	getNode: () => ConstructorParameters<typeof NodeOperationError>[0],
): IDataObject | undefined {
	if (!value.trim()) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new NodeOperationError(getNode(), `${fieldName} must be valid JSON`, {
			description: error instanceof Error ? error.message : undefined,
		});
	}

	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		throw new NodeOperationError(getNode(), `${fieldName} must be a JSON object`);
	}

	return parsed as IDataObject;
}

export function parseOptionalArray(
	value: string,
	fieldName: string,
	getNode: () => ConstructorParameters<typeof NodeOperationError>[0],
): IDataObject[] | undefined {
	if (!value.trim()) return undefined;

	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch (error) {
		throw new NodeOperationError(getNode(), `${fieldName} must be valid JSON`, {
			description: error instanceof Error ? error.message : undefined,
		});
	}

	if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'object' || item === null || Array.isArray(item))) {
		throw new NodeOperationError(getNode(), `${fieldName} must be a JSON array of objects`);
	}

	return parsed as IDataObject[];
}
