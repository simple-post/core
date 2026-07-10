export const CLI_CONFIG_SCHEMA_VERSION = 1;
export const SECRET_FILE_SCHEMA_VERSION = 1;
export const DEFAULT_PASSWORD_ENV_VAR = "SIMPLE_POST_CONFIG_PASSWORD";
export const DEFAULT_CALLBACK_PORT = 5000;
export const DEFAULT_OAUTH_REDIRECT_URI = "http://127.0.0.1:5000/oauth/callback";
/** Facebook / Threads loopback redirect (Meta app must list this exact URL). */
export const META_OAUTH_REDIRECT_URI = "http://localhost:5000/oauth/callback";
export const KEYCHAIN_SERVICE_NAME = "simplepost-cli";
export const CONFIG_FILE_NAME = "config.json";
export const PLAIN_SECRETS_FILE_NAME = "secrets.json";
export const ENCRYPTED_SECRETS_FILE_NAME = "secrets.enc.json";
export const DEFAULT_OAUTH_TIMEOUT_MS = 90_000;
