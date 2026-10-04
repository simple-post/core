import type { IDataObject } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export function normalizeBaseUrl(value: string): string {
	return value.replace(/\/+$/, '');
}

// The Scheduler API only accepts UTC `Z` timestamps, while n8n date pickers and
// Luxon expressions commonly produce offset or zone-less ISO strings.
export function normalizeScheduledFor(
	value: string,
	getNode: () => ConstructorParameters<typeof NodeOperationError>[0],
): string {
	const parsed = new Date(value);
	if (!value.trim() || Number.isNaN(parsed.getTime())) {
		throw new NodeOperationError(getNode(), 'Scheduled For must be a valid date and time');
	}

	return parsed.toISOString();
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
