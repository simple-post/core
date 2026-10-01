# SimplePost MCP review investigation — 2026-10-01

This records the inspected portal state before the metadata corrections below. It is not a successful scan or approval. No support message has been sent.

## Verified portal evidence

- Plugin ID: `plugin_asdk_app_69f882652190819192ab1c88f1218795`
- Associated MCP app: `asdk_app_69f882652190819192ab1c88f1218795`
- Selected version ID: `appsub_6abe579d45ac8191b8636a84814c4afb`
- Endpoint: `https://app.simplepost.social/mcp`
- Authentication: Authorized. Domain: verified.
- Last checked: 2026-10-01 15:36:25 Europe/Berlin (13:36:25 UTC), as displayed in the opened tool and instructions drawers.
- The tools table contains all 23 expected tools. `update_post_editor_session` is now Live following the destructive annotation correction.
- Server instructions and the four tools in the table below show Earlier version live. Their drawers provide only generic further-review findings.
- The four tool drawers offer a Live definition tab but show: “An earlier definition is live, but its JSON is unavailable.” A precise comparison with the retained live tool contracts is therefore unavailable in this portal state.
- `create_post` also shows Earlier version live and `commit_post_editor_session` shows Not live in the tools table. Neither appears in the visible issues list. Their availability must be checked before claiming the complete publishing/editor workflow is live.

| Tool | readOnlyHint | destructiveHint | openWorldHint | idempotentHint |
| --- | --- | --- | --- | --- |
| list_accounts | true | false | false | true |
| inspect_posts | true | false | false | true |
| update_scheduled_post | false | true | true | false |
| discard_scheduled_post | false | true | true | false |

These are the server-provided values visible in the held definitions. Reading connected-account metadata and SimplePost records is private-account access. Updating a post can overwrite content or schedule future external publication. Discarding permanently deletes the stored post and media. The annotations match these behaviors; changing them simply to seek approval would be inaccurate.

## Concrete source corrections

1. Removed “Choose a plan when remaining is zero” from `mcpAccountSchema.trialAllowance`. The field now describes the actual posting restriction. The portal's held output schemas confirm this shared description occurs in all four tools: `accounts[].trialAllowance` on list_accounts, `posts[].accounts[].trialAllowance` on inspect_posts, and `post.accounts[].trialAllowance` on update/discard. Field names, types, optionality, quotas, and handlers are preserved.
2. Corrected inspect_posts' claim that it supports text filters. Its actual inputs are status, page, limit, and postId; no text-search parameter exists. Its description now states the supported inputs.
3. Scoped the opening instructions and unsupported-action routing to SimplePost tools. The previous “do not call any tool” wording was broader than this server's authority. Preserved selected-editor writing, authorization boundaries, legacy tool routes, media handling, and scheduling guidance.
4. Replaced the instruction to change plans after an allowance denial with factual restriction reporting and no purchase/subscription offer. The existing no-automatic-retry and no-bypass guidance remains.

The portal did not identify any of these as the cause of its generic holds. These are accuracy/scope corrections, not a claimed approval workaround. Tool handlers, input/output shapes, safety annotations, resource URIs, and the production endpoint are unchanged by this follow-up.

## Deployment and verification

Deploy the corrected server to the production endpoint before rescanning the existing MCP connection. A ZIP upload does not update hosted server instructions or tool descriptions. Confirm the scanned inspect_posts description mentions status/pagination and that the four shared allowance descriptions no longer contain “Choose a plan.”

Inspect availability as well as the issues list. Do not remove/re-add tools, rename the server, disable safety hints, create a duplicate plugin, or change origins to evade held checks. OpenAI retains the earlier metadata while calls use the current implementation. Preserve compatibility throughout the review gap.

If the same generic findings persist after the deployed scan, update the scan timestamp and evidence in the draft below and contact OpenAI support. The official [MCP review guide](https://developers.openai.com/plugins/deploy/app-review#continuous-review-and-tool-updates) explains the held-update behavior; its [Getting help](https://developers.openai.com/plugins/deploy/app-review#getting-help) section requests the plugin ID. Ask for diagnostic detail, not expedited review.

## Support request draft

Subject: SimplePost MCP continuous-review holds without actionable findings

Hello OpenAI support,

Our existing SimplePost plugin (`plugin_asdk_app_69f882652190819192ab1c88f1218795`) has persistent MCP continuous-review holds with only generic findings. The associated MCP app is `asdk_app_69f882652190819192ab1c88f1218795`, the selected version is `appsub_6abe579d45ac8191b8636a84814c4afb`, and the endpoint is `https://app.simplepost.social/mcp`. Authentication is authorized and domain verification passes.

The scan inspected on 2026-10-01 at 13:36:25 UTC reports “These server instructions need further review” and “This tool update needs further review before it can go live” for list_accounts, inspect_posts, update_scheduled_post, and discard_scheduled_post. The portal retains earlier versions of these definitions, but their Live definition tabs say the earlier JSON is unavailable. We cannot establish the exact retained tool definitions from the portal.

We fixed the separate update_post_editor_session annotation finding: full working-copy replacement now declares destructiveHint:true, and the portal shows that tool Live. The remaining read tools advertise readOnlyHint:true and destructiveHint:false; the update and discard tools advertise readOnlyHint:false and destructiveHint:true. They are scoped to the authenticated user's SimplePost records, and cannot change already-published external posts.

The source follow-up also removes a plan-selection instruction embedded in the shared account output schema, corrects inspect_posts' unsupported text-filter claim, and scopes routing instructions to SimplePost tools. These corrections preserve the tools' names, handlers, schema shapes, annotations, and endpoint. The captured scan above predates that follow-up; we will supply its deployed rescan timestamp and findings when available.

Additionally, create_post shows Earlier version live and commit_post_editor_session shows Not live, while neither appears in the visible issues list. Could you clarify these statuses and the actionable reason for the remaining tool/instruction holds? Please also advise how we can obtain the retained live definitions for compatibility verification.

We are asking for diagnostic guidance, not an expedited review. We can provide the tool-definition snapshots and test evidence through the secure support channel. No credentials are included here.
