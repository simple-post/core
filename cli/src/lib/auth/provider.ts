import type { AccountPlatform } from "../account/platforms.js";
import type { CliConfigV1, CliPaths } from "../types.js";
import type { SecretStore } from "../secrets.js";
import type { PromptSession } from "../ux/prompt.js";

export interface OAuthLoginFlags {
  alias?: string;
  callbackUrl?: string;
  noBrowser?: boolean;
  redirectUri?: string;
}

export interface AuthProviderContext {
  config: CliConfigV1;
  paths: CliPaths;
  prompt: PromptSession;
  secretStore: SecretStore;
}

export interface AuthProvider<TLoginFlags = OAuthLoginFlags> {
  readonly platform: AccountPlatform;
  login(flags: TLoginFlags, context: AuthProviderContext): Promise<CliConfigV1>;
}
