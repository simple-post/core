# Muse connector submission kit

Prepared 2026-09-29. Nothing here submits data, accepts terms or creates access. [`docs/MUSE.md`](../../docs/MUSE.md) documents installation/model examples and their limits.

## 1. Personal Muse agent: connector directory

Updated **2026-10-03**: the dedicated [Personal Muse review kit](../personal-muse/README.md) now includes read-only OAuth consent, generated current tool schemas/risk classifications, data-processing answers and a detailed [review/publication runbook](../personal-muse/REVIEW.md). [Meta's public connector guidelines](https://muse.ai/platform/docs) explicitly accept API or MCP documentation. Use that kit for the personal agent; the model and Muse Code examples are not a substitute.

Open [Muse Connector Platform](https://muse.ai/platform), click **Submit a connector**, and log in with your **work email**. Private portal form fields, actual OAuth callback and live Personal Muse approval/UI behavior still need maintainer verification. The listing below is ready-to-copy editorial material, **not** an official manifest/upload format.

Meta says submitted connectors receive functional, security and legal review with end-to-end testing. Directory publication follows approval, and featured placement is a separate editorial decision.

### Suggested product/listing answers

| Field/topic            | Prepared answer                                                                                                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product name           | SimplePost                                                                                                                                                                       |
| Website                | https://simplepost.social                                                                                                                                                        |
| Category               | Social media / Marketing & Media                                                                                                                                                 |
| Short description      | Draft, validate, schedule and publish social content using your connected SimplePost accounts.                                                                                   |
| User benefit           | Turn a reviewed brief into a post, check destination-specific requirements, and manage publication through one connected service.                                                |
| Account prerequisite   | A SimplePost account, appropriate plan entitlement and connected social destinations. Users authorize their own accounts.                                                        |
| Existing integration   | Remote MCP over Streamable HTTP at `https://app.simplepost.social/mcp`, with OAuth authorization and per-user isolation. Hosted REST API is also available.                      |
| Documentation          | https://docs.simplepost.social/mcp and https://docs.simplepost.social/api                                                                                                        |
| Source / issues        | https://github.com/simple-post/core and https://github.com/simple-post/core/issues                                                                                               |
| Primary demonstration  | Discover accounts → validate final copy → preview → save an approved draft → inspect it. Publish/schedule only after explicit approval of copy, media and targets.               |
| Supported capabilities | Account discovery, content validation/preview, drafts, publication, scheduling and post inspection/management, subject to the authenticated user's accounts and available tools. |

Avoid claiming all SDK platforms are equally available in hosted accounts. Check the current [platform matrix](https://docs.simplepost.social/platform-matrix), [plan/features](https://simplepost.social/pricing) and actual MCP tool inventory. Do not promise WhatsApp posting, Muse approval, payment integration, native image generation or video rendering in this connector.

### Technical handoff for Meta review

- Public legal/support references: [privacy policy](https://app.simplepost.social/privacy), [terms](https://app.simplepost.social/terms), `support@simplepost.social`. Confirm these still match the submitted company and data practices before review; production URLs responded successfully during preparation.
- Endpoint: `https://app.simplepost.social/mcp`; transport: Streamable HTTP. Use normal OAuth discovery/registration; never ship a shared SimplePost API key or static social tokens.
- Existing REST fallback: `https://app.simplepost.social/api/v1`; [API contract/authentication documentation](https://docs.simplepost.social/api) and [public OpenAPI document](https://app.simplepost.social/api/openapi.json). REST API keys are not a substitute for a consumer connector's per-user OAuth consent. Build any required adapter only after Meta specifies its protocol and permission model.
- Skill behavior reference: [`skills/simplepost/SKILL.md`](../../skills/simplepost/SKILL.md) and [`references/mcp.md`](../../skills/simplepost/references/mcp.md). This is execution guidance, not a claim that the personal Muse agent imports coding-agent skills.
- No inferred write approval; exact content, account IDs and timing need user approval. Respect per-account failures, asynchronous states, cancellation limits and same-key recovery of uncertain writes.
- Provide a dedicated test user with connected sandbox/test destinations through Meta's private review channel. Never commit credentials or include them in a public PR.
- Test user isolation, token refresh/expiry/revocation, denied consent, duplicate-write recovery, invalid media and destination errors. Verify behavior matches the declared permissions and review UI.

### Maintainer publication checklist

- [ ] Merge this core PR; choose the tested release/commit for review evidence.
- [ ] Sign into the Muse platform with the intended company/work account.
- [ ] Use the dedicated Personal Muse review kit and confirm private form fields, actual OAuth callback, narrower grant handling and write-confirmation behavior. Public guidelines already accept API/MCP.
- [ ] Supply company/legal/contact information yourself; confirm public privacy policy, terms and support links. Do not invent these details from repository metadata.
- [ ] Run the dedicated review acceptance scenarios using the hosted MCP, including read-only consent and sensitive approval every use; address actual review-harness incompatibilities if found.
- [ ] Test connection, denied consent, reconnect, revocation and isolation with a dedicated review account.
- [ ] Record a short demo with test content showing discovery, validation, preview, approved draft and inspection. Include explicit approval before demonstrating publishing.
- [ ] Provide current icon/logo, screenshots, descriptions and capability/permission disclosures in the required formats.
- [ ] Review terms and data-handling obligations; accept/submit yourself.
- [ ] Address Meta review feedback and repeat end-to-end testing.
- [ ] Verify the approved directory entry and real-user connect flow before announcing availability.

## 2. Meta AI connectors: separate early-access application

[Meta AI Connectors](https://dev.meta.ai/products/connectors) covers Meta AI app, web and glasses. Its public form is an early-access request, not a guarantee of immediate directory publication. It links the personal Muse platform as a separate route.

Prepared application description:

> SimplePost provides a live social publishing API and OAuth-enabled remote MCP server. Users can discover connected destinations, validate and preview content, save drafts, and publish or schedule explicitly approved posts. We would like to offer an account-isolated social publishing connector for Meta AI, using our existing API and OAuth workflow. Documentation: https://docs.simplepost.social/mcp and https://docs.simplepost.social/api. Category: Marketing & Media.

For the current public form, use **Yes — live in production and serving users** for the live-REST-API question, **REST API (OpenAPI / Swagger spec)** for protocol, `https://docs.simplepost.social/api` for API docs, and **Marketing & Media** for industry. Describe our OAuth MCP server in the free-text answer; MCP is an onboarding path described on the page, not a protocol checkbox in this form. Select prior AI integrations only when they have actually been deployed/tested, rather than merely prepared in a PR. Provide the actual company/contact, role, team size, desired surfaces and start date yourself; do not invent identity or volume numbers.

- [ ] Review the current preview eligibility and required implementation details.
- [ ] Fill the contact/company fields, use case, live-API and protocol answers.
- [ ] Submit the access request yourself and retain the confirmation.
- [ ] After selection, obtain Meta's integration contract/test harness and implement any additional adapter.
- [ ] Complete OAuth, permissions, security and end-to-end checks; publish only through the route Meta provides.

## 3. Muse Code and models: compatibility release checks

These do not require directory admission for local use.

- [ ] Install current Muse Code from Meta's official source and record version/OS.
- [ ] Validate/install the **canonical core skill**, inspect it and confirm references are present.
- [ ] Merge the MCP snippet without replacing other settings; log in with OAuth and verify `/mcp`.
- [ ] Discover accounts; validate and preview exact test copy; save/inspect an approved draft.
- [ ] Restart, refresh/reconnect and revoke the grant; confirm credentials do not appear in logs.
- [ ] Enable Meta Model API access/billing; provision secrets outside source control.
- [ ] Run the Spark read-only example, including invalid target/tool tests and per-account validation failures.
- [ ] Review a text-only JSON payload; use a retained idempotency key for the separate draft command. Simulate uncertain response/replay without creating duplicate drafts.
- [ ] Generate/edit one approved test image; transcribe an approved WAV; inspect SAM event output and decoded geometry separately.
- [ ] If supporting Glimmer, serve a chosen variant locally, verify tool parsing and confirm Meta credentials never reach that runtime.
- [ ] Inspect media in the SimplePost composer and validate every actual destination before any approved publish.
- [ ] Record live results/limitations; update compatibility docs without claiming connector approval.
