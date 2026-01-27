# Bluesky App Setup Guide

This guide explains how to create and configure an OAuth application for Bluesky (AT Protocol).

## Overview

Unlike traditional OAuth providers, Bluesky uses the AT Protocol's decentralized OAuth system. This means:

- **No app registration portal** - You don't need to register your app on a developer dashboard
- **No client secrets for public apps** - Browser and mobile apps don't use secrets
- **Client metadata document** - Your app is identified by a JSON file hosted at a public URL
- **Your `client_id` is the URL** - The URL where your metadata is hosted becomes your client ID

## Client Types

| Type           | OAuth Client Type | Use Case                        |
| -------------- | ----------------- | ------------------------------- |
| Web Service    | Confidential      | Backend servers with database   |
| Browser App    | Public            | Single-page applications (SPAs) |
| Mobile/Desktop | Public            | Native applications             |

## Step 1: Create Client Metadata Document

Create a JSON file that describes your application. This file must be publicly accessible via HTTPS.

### Browser App Example

Host this at `https://yourapp.com/oauth/client-metadata.json`:

```json
{
  "client_id": "https://yourapp.com/oauth/client-metadata.json",
  "application_type": "web",
  "client_name": "Your App Name",
  "client_uri": "https://yourapp.com",
  "dpop_bound_access_tokens": true,
  "grant_types": ["authorization_code", "refresh_token"],
  "redirect_uris": ["https://yourapp.com/oauth/callback"],
  "response_types": ["code"],
  "scope": "atproto transition:generic",
  "token_endpoint_auth_method": "none"
}
```

### Web Service (Confidential Client) Example

For backend services that can securely store keys:

```json
{
  "client_id": "https://yourapp.com/oauth/client-metadata.json",
  "application_type": "web",
  "client_name": "Your App Name",
  "client_uri": "https://yourapp.com",
  "dpop_bound_access_tokens": true,
  "grant_types": ["authorization_code", "refresh_token"],
  "redirect_uris": ["https://yourapp.com/oauth/callback"],
  "response_types": ["code"],
  "scope": "atproto transition:generic",
  "token_endpoint_auth_method": "private_key_jwt",
  "token_endpoint_auth_signing_alg": "ES256",
  "jwks": {
    "keys": [
      {
        "kty": "EC",
        "crv": "P-256",
        "x": "YOUR_PUBLIC_KEY_X",
        "y": "YOUR_PUBLIC_KEY_Y",
        "kid": "key-1"
      }
    ]
  }
}
```

### Generating JWKS Keys

Bluesky requires ES256 (ECDSA with P-256 curve) keys for confidential clients. Here's how to generate them:

#### Using Node.js

```javascript
const crypto = require("crypto");

// Generate EC key pair
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
  namedCurve: "P-256",
});

// Export as JWK
const privateJwk = privateKey.export({ format: "jwk" });
const publicJwk = publicKey.export({ format: "jwk" });

// Add key ID
privateJwk.kid = "key-1";
publicJwk.kid = "key-1";

console.log("Private Key (keep secret!):");
console.log(JSON.stringify(privateJwk, null, 2));

console.log("\nPublic Key (for client metadata):");
console.log(JSON.stringify(publicJwk, null, 2));
```

Output example:

```json
// Private Key (store securely, never expose)
{
  "kty": "EC",
  "crv": "P-256",
  "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  "d": "jpsQnnGQmL-YBIffH1136cspYG6-0iY7X1fCE9-E9LI",
  "kid": "key-1"
}

// Public Key (include in client metadata)
{
  "kty": "EC",
  "crv": "P-256",
  "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  "kid": "key-1"
}
```

#### Using OpenSSL

```bash
# Generate private key
openssl ecparam -name prime256v1 -genkey -noout -out private.pem

# Extract public key
openssl ec -in private.pem -pubout -out public.pem

# Convert to JWK format (requires additional tooling like step-cli)
step crypto jwk create public.jwk private.jwk --kty EC --crv P-256
```

#### Using jose Library (Recommended for Production)

```bash
npm install jose
```

```typescript
import { generateKeyPair, exportJWK } from "jose";

async function generateKeys() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");

  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  // Add key ID
  publicJwk.kid = "key-1";
  privateJwk.kid = "key-1";

  console.log("Public JWK (for metadata):", JSON.stringify(publicJwk, null, 2));
  console.log("Private JWK (keep secret):", JSON.stringify(privateJwk, null, 2));
}

generateKeys();
```

#### Key Storage Best Practices

| Environment | Recommended Storage                                           |
| ----------- | ------------------------------------------------------------- |
| Production  | Secrets Manager (AWS, GCP, Azure) or Hardware Security Module |
| Development | Environment variables or encrypted config                     |
| Never       | Source code, git repositories, client-side code               |

The **public key** goes in your client metadata (`jwks.keys[]`). The **private key** is stored securely on your server and used to sign JWT assertions.

## Step 2: Required Metadata Fields

| Field                        | Required | Description                                                   |
| ---------------------------- | -------- | ------------------------------------------------------------- |
| `client_id`                  | Yes      | Must exactly match the URL where metadata is hosted           |
| `dpop_bound_access_tokens`   | Yes      | Must be `true` (DPoP is mandatory)                            |
| `grant_types`                | Yes      | Use `["authorization_code", "refresh_token"]`                 |
| `redirect_uris`              | Yes      | Your callback URL(s)                                          |
| `response_types`             | Yes      | Use `["code"]`                                                |
| `scope`                      | Yes      | Must include `atproto`                                        |
| `token_endpoint_auth_method` | No       | `none` for public clients, `private_key_jwt` for confidential |

### Optional (Recommended) Fields

| Field         | Description                                           |
| ------------- | ----------------------------------------------------- |
| `client_name` | Human-readable name shown during authorization        |
| `client_uri`  | Homepage URL (must have same hostname as `client_id`) |
| `logo_uri`    | URL to your app's logo                                |
| `tos_uri`     | Terms of service URL                                  |
| `policy_uri`  | Privacy policy URL                                    |

## Step 3: Host the Metadata

1. Save the JSON file to your web server
2. Ensure it's accessible at the exact URL specified in `client_id`
3. Serve with `Content-Type: application/json`
4. Return HTTP status 200 (no redirects)

### Verification

Test your metadata is accessible:

```bash
curl -I https://yourapp.com/oauth/client-metadata.json
# Should return: HTTP/2 200, Content-Type: application/json
```

## Step 4: Implement OAuth Flow

Bluesky OAuth requires these components:

### PKCE (Proof Key for Code Exchange)

- Generate a random code verifier (32-96 bytes, base64url encoded)
- Create a code challenge using SHA-256 hash
- Include challenge in authorization request, verify in token request

### PAR (Pushed Authorization Requests)

- POST authorization parameters to the PAR endpoint
- Receive a `request_uri` token
- Redirect user to authorization endpoint with the token

### DPoP (Demonstrating Proof of Possession)

- Generate a unique keypair for each auth session
- Sign a JWT for every request (token and API requests)
- Handle server-provided nonces via `DPoP-Nonce` header

## Using the Official SDK

For TypeScript/JavaScript, use the official AT Protocol OAuth libraries:

### Browser Apps

```bash
npm install @atproto/oauth-client-browser
```

### Node.js Backend

```bash
npm install @atproto/oauth-client-node
```

### Example Implementation

```typescript
import { BrowserOAuthClient } from "@atproto/oauth-client-browser";

const client = new BrowserOAuthClient({
  clientMetadata: {
    client_id: "https://yourapp.com/oauth/client-metadata.json",
    redirect_uris: ["https://yourapp.com/oauth/callback"],
    scope: "atproto transition:generic",
    // ... other metadata
  },
});

// Start authorization
const authUrl = await client.authorize(handle);
window.location.href = authUrl;

// Handle callback
const session = await client.callback(window.location.href);
```

## Scopes

| Scope                | Description                              |
| -------------------- | ---------------------------------------- |
| `atproto`            | Required - basic AT Protocol access      |
| `transition:generic` | Recommended - general application access |

## Important Notes

1. **No App Passwords for OAuth** - OAuth replaces the legacy App Password system
2. **DPoP Keys Are Per-Session** - Never reuse DPoP keys across users or sessions
3. **Handle Resolution** - Resolve handles to DIDs before starting the OAuth flow
4. **Verify `sub` Claim** - Always verify the returned DID matches the expected account

## Redirect URI Formats

| Client Type | Redirect URI Format                            |
| ----------- | ---------------------------------------------- |
| Web Service | `https://yourapp.com/callback`                 |
| Browser App | `https://yourapp.com/callback`                 |
| Android     | App Links                                      |
| iOS         | Universal Links                                |
| Desktop     | Custom URI scheme (e.g., `yourapp://callback`) |

## Troubleshooting

### "Invalid client_id"

- Ensure the URL in `client_id` exactly matches where the JSON is hosted
- Check there are no redirects when fetching the metadata

### DPoP Nonce Errors

- The server returns `use_dpop_nonce` error with a fresh nonce in headers
- Retry the request with the new nonce value

### Token Refresh Issues

- Refresh tokens periodically before they expire
- Never make concurrent refresh requests for the same session

## Resources

- [AT Protocol OAuth Specification](https://atproto.com/specs/auth)
- [OAuth Client Implementation Guide](https://docs.bsky.app/docs/advanced-guides/oauth-client)
- [Bluesky Developer Documentation](https://docs.bsky.app)
