# TikTok error diagnostics

TikTok failures retain their sanitized provider response instead of only a generic upload error. This covers public and draft video initialization, photo initialization, chunk uploads, creator checks, processing/status polling, and OAuth token refreshes. It does not change publishing retries, outcome classification, or the polling budget.

## Where to find them

- SDK failures: `PostError.details` and the SDK post result's `details`.
- Failed posts: `Post.errorDetails.failedPlatforms[].details` and `Post.accountResults[accountId].details`.
- Recovered upload/status failures: the successful TikTok account result's `details`, also logged with the successful segment. Already successful accounts retain their recorded outcome on later retries.
- Readiness checks: the validation issue's `meta.tiktokDiagnostics`.
- Creator-info checks: the `tiktok-creator-info` logger's `details` field, correlated through the existing request trace.
- Token refresh failures: the credential-refresh warning's `details` and encrypted account metadata's `lastRefreshErrorDetails`. Successful refresh clears the current error metadata.

Use the post/account ID and trace to locate the operation. The diagnostics include the phase, API endpoint and method, mode, media type and relevant upload size/chunk range, attempt number, publishing job ID, HTTP status, TikTok code/message/log ID, response headers and full response body. Transport failures include their error code/message, stack, cause and configured timeout when available. Non-JSON responses are retained as text. Missing fields mean the provider did not supply them.

Status diagnostics retain failed polling attempts and the last response when the budget expires. Recovered upload-session failures retain the rejected session's publishing job ID and chunk context. Within a publishing operation, a successful upload/status retry does not erase this evidence. Post records describe the latest account outcome; per-attempt logs remain the place to inspect earlier requests.

## Redaction and limits

Access/refresh tokens, application credentials, authorization/cookie headers and signed upload URLs are redacted. URL query strings/fragments and known account/application secrets are removed from free-text messages too. Axios request/config objects and outgoing request bodies are never serialized. Other provider response fields are retained, including fields not recognized by the application.

Each diagnostic snapshot is limited to 64 Ki characters, 2,000 visited nodes and 12 nesting levels. Oversized data is marked with `[TRUNCATED]` and `diagnosticsTruncated: true`; circular references are marked explicitly. These are diagnostic storage limits, not changes to TikTok request or retry limits.

Historical generic errors cannot be reconstructed. The additional details become available for new requests after deployment.

References: [TikTok error handling](https://developers.tiktok.com/docs/en/tiktok-api-v2-error-handling), [upload responses](https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video), [media transfer](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide), and [processing status](https://developers.tiktok.com/docs/en/content-posting-api-reference-get-video-status).
