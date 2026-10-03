# SimplePost for the Personal Muse AI agent

Prepared against [Meta's Personal Muse connector guidelines](https://muse.ai/platform/docs) on **2026-10-03**, using the latest `core`. This package is specifically for the consumer/personal Muse agent and its connector directory. Muse Code, Meta models and the separate Meta AI app/web/glasses developer preview are different surfaces.

The integration uses the existing production OAuth-enabled MCP server at **https://app.simplepost.social/mcp**. Meta's published guidelines accept **API or MCP** documentation. No new publishing service, social provider, model credentials or duplicate skill is needed. The canonical [`skills/simplepost`](../../skills/simplepost) remains the behavior reference; there is no assumption that Personal Muse imports coding-agent skills.

This is **prepared, not submitted, approved or live-tested in Personal Muse**. Portal-only fields, supported UI/attachment behavior and the actual Muse OAuth callback must be confirmed by the maintainer. `connector.json` and `tool-review.json` are internal editorial/review formats, not a claimed Meta upload manifest.

## What is implemented

- The SimplePost OAuth consent page offers **Read only** or **Read and write**. Read-only is the default on the MCP consent screen; existing programmatic consent requests remain backward-compatible when `access_mode` is omitted. CLI authorization does not gain this toggle.
- Read-only grants retain only the requested identity/account/post-read scopes. They exclude **both** `posts:write` and `posts:validate`: MCP validation and preview can import media, even without image fitting. Empty or invalid grants fail closed. Choosing access never expands a client's registered/requested scopes.
- Existing MCP handlers enforce these scopes. REST authentication also enforces narrowed MCP grants, so the token cannot bypass consent through REST mutations or fall back to a broader browser session. API keys, CLI tokens and normal browser sessions are unchanged.
- A reproducible review bundle exports actual registered tool descriptions, input/output JSON schemas and MCP hints, plus Muse-specific **read / write / sensitive write** classifications. All four combinations of base vs extension tools and image-fitting entitlement are separate. All 23 tools are covered; 12 are always registered and 11 depend on the workspace/editor entitlement.
- Offline tests verify catalog completeness, risk labels, exported schemas, rejected write calls, OAuth narrowing and REST enforcement. CI uploads the generated review bundle.

## Prepare the review bundle

From the repository root, with the locked dependencies installed:

```bash
yarn muse:personal:check
yarn muse:personal:prepare
```

The output is `dist/personal-muse-connector/`. The preparation command registers the real core tools under test and exports schemas without executing tools, querying customer data or contacting Meta. It copies the existing approved transparent SP logo and review documents. `build-info.json` records the source revision and whether the checkout was dirty. Rebuild from a clean deployed commit for submission evidence.

The command refuses to replace an existing directory. To preserve an earlier bundle and generate a new one:

```bash
yarn muse:personal:prepare --out dist/personal-muse-review-v2
```

The kit contains:

| File                                  | Use                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `connector.json`                      | Copy-ready listing, endpoints, scopes and availability restrictions                                  |
| `tool-contracts.json`                 | Actual current tool schemas and annotations for all four entitlement profiles                        |
| `TOOL_REVIEW.md` / `tool-review.json` | Muse risk classifications, approval policy, permissions and side effects                             |
| `REVIEW.md`                           | Reviewer account setup, complete workflows, failure/permission tests, demo and publication checklist |
| `DATA_PROCESSING.md`                  | Evidence-based questionnaire draft and owner confirmations still needed                              |
| `simplepost-logo.svg`                 | Current authorized repository brand asset; adapt dimensions only if the portal requires it           |
| `build-info.json`                     | Source revision and explicit untested/unsubmitted status                                             |

## OAuth and permission contract

Use OAuth discovery and PKCE S256, not a shared API key. Discovery endpoints, registration endpoint and scope lists are in `connector.json`. Register **the exact callback Meta supplies**; do not invent one. Public clients use `token_endpoint_auth_method: none`; confidential clients use the supported secret method required by Meta. Keep any client secret in the private portal/secret manager.

The token exchange returns the **granted** scope, which may be narrower than requested. Muse must honor that result and support reconnecting when a user deliberately upgrades access. Current SimplePost grants use authorization codes and expiring access tokens; refresh-token grants are not advertised. Verify expiry/reconnect and revocation with the deployed release.

Read-only is useful for account discovery, post inspection, scheduled-post lookup and saved previews. `show_post_preview` with unsaved supplied content requires `posts:validate` and is not available under read-only consent. Tool discovery currently includes unavailable write tools; the server rejects their calls under a narrowed grant. Do not present those actions as enabled.

For **read and ordinary write** tools, Meta specifies ask-on-first-use with its allow-once/always-allow/deny controls. For **sensitive writes**, require approval **every use**, never an always-allow permission. Classify the whole tool conservatively when it mixes draft/save with publishing. `create_post`, `update_scheduled_post`, `discard_scheduled_post`, `commit_post_editor_session` and destructive working-copy replacement are sensitive in this review kit. Read-only MCP hints alone cannot express Muse's sensitive-write category. Meta says its portal annotation interface is coming soon, so provide these classifications as review material and confirm actual approval behavior before publication.

Connecting an account is not approval to publish. Show exact content, media, target accounts, mode and timing before a sensitive write. Changed details require a new approval. The host approval UI is owned by Muse, not implemented or bypassed by this server. Do not claim that this kit itself installs Muse-side approval enforcement.

## Results, failures and limitations

- `create_post` in draft mode saves without publication. Drafts can contain validation problems: inspect the returned validation and explain them. In schedule mode, `status: scheduled` is not proof of eventual publication. Inspect post state at/after the scheduled time.
- Immediate publishing returns per-account `postingResults`; partial failure is not global success. Inspect the failed destination before retrying. Draft/scheduled cancellation is supported; removing already-published social content is not.
- Reuse the original `idempotencyKey` and unchanged payload after an uncertain creation outcome. Inspect existing state before retrying. A changed payload or new intended post needs a separate reviewed operation; updates/deletes are not blanket-idempotent.
- Billing/allowance, account readiness, platform restrictions and feature entitlements remain enforced. Explain a terminal access error; do not repeatedly reconnect, poll or retry to evade it. Do not promise every SDK destination is available in every hosted account.
- Respect HTTP 429/retry guidance and provider throttling; there is no verified Muse-specific numeric rate limit. Structured MCP errors include diagnostic/recovery information. Do not retry a non-retryable error or blindly repeat an uncertain write.
- Base workflows work through text/structured results. MCP Apps sidebar support, Meta attachment references, model generation, background callbacks and native Muse notifications are **not** verified or newly implemented here. Prefer public test media URLs; use `get_schedule` and `inspect_posts` for data-only checks.

Publication steps and reviewer evidence are in [REVIEW.md](REVIEW.md). The older multi-surface kit is [Meta Muse submission overview](../meta-muse/CONNECTOR_SUBMISSION.md).
