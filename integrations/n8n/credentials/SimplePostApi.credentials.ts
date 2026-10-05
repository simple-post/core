import type {
	IAuthenticateGeneric,
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class SimplePostApi implements ICredentialType {
	name = 'simplePostApi';

	displayName = 'SimplePost API';

	icon: Icon = {
		light: 'file:../nodes/SimplePost/simplePost.svg',
		dark: 'file:../nodes/SimplePost/simplePost.dark.svg',
	};

	documentationUrl = 'https://github.com/simple-post/core/tree/main/integrations/n8n#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			placeholder: 'e.g. sp_api_...',
			description: 'Create an API key on the API Keys page of the SimplePost app',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://app.simplepost.social',
			required: true,
			description:
				'Keep the default for hosted SimplePost, or enter the URL of your self-hosted Scheduler app',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl.replace(/\\/+$/, "")}}',
			url: '/api/v1/accounts',
			method: 'GET',
		},
	};
}
