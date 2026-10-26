# First-post onboarding and preview import

New users start on the dashboard with a free-trial banner and three short checklist rows: connect a social account, install SimplePost in an assistant, and schedule a first post. There is no welcome dialog. Trial details sit inline with the banner copy.

The install dialog opens only when requested. It offers ChatGPT, Claude Code, OpenClaw, and Others; Claude, generic MCP, and CLI setup live under Others. Its dimensions stay fixed while setup details scroll. Opening the ChatGPT installation link closes the dialog. The scheduler does not show starter prompts or example posts. Onboarding refreshes when the user returns from the assistant's tab so a completed authorization is reflected immediately.

Assistant-first signups still need a social publishing destination. MCP responses provide a clickable account-connection link built from the deployment's app URL, including when reading a schedule with no accounts or attempting to prepare a post. They ask the user to connect an account and return to the conversation. No plugin package changes are required. The link opens the account picker at `/accounts?onboarding=connect`. Successful first-account and onboarding connections return to the dashboard with a brief confirmation, without an installation dialog or starter prompt. Reconnecting or adding further accounts from Accounts keeps the user on that page.

The checklist completes after a connected account, an assistant credential, and a scheduled or published post exist. Drafts, pending posts, and failed posts do not complete the scheduling step. Users do not have to wait for publication or confirm its success. Existing publishing analytics remain separate. No database columns or migrations are needed.

## Preview import contract

Deploy this app change before the companion website preview CTA. The receiver is backward compatible with existing app links.

1. The website opens `/import#preview=<URI-encoded JSON>` in another tab. v1 accepts only known preview platform IDs, message strings, ordered follow-up strings and a media-presence flag. It does not accept account IDs, scheduling instructions, media URLs or identity fields. Limits are 11 variants, 126,412 UTF-16 units per segment (enough for 63,206 supplementary Unicode characters), 24 follow-ups per version and 200,000 JSON UTF-16 units overall; encoded fragments are capped at 1,800,000 characters. Publishing limits remain platform- and plan-specific.
2. The public receiver strips the fragment, validates it, stores a temporary browser copy, and redirects to `/schedule?preview=<random UUID>`. Only that opaque identifier passes through Google/magic-link auth; post text is never in the auth callback or analytics URL.
3. On the composer, the user chooses one preserved platform version and explicitly imports it. A nonempty unsaved draft requires a replacement checkbox. Import resets accounts, overrides, schedule, media and repost settings, restores text and thread, and chooses draft mode. The user still selects accounts, uploads media and submits the form.
4. Browser copies expire after 24 hours. Dismissal removes the copy; opening another transfer cleans expired copies. Different browsers/devices cannot access it. Invalid links, expiry and unavailable storage show recovery guidance. Forem preview text can be imported, but hosted publishing availability is unchanged.

`Preview Draft Imported` fires on explicit import with a platform property. No draft text is sent. The removed onboarding prompt no longer emits `Activation Prompt Copied`. Configure named goals in Plausible if needed; no live analytics settings are changed by this PR.

## Validation

Automated coverage validates the transfer boundary, Unicode and threads, rejected shapes and size limits, expiration, and milestone query semantics. Local browser review uses synthetic content: website preview → app sign-in with opaque ID, then the actual import component under a temporary provider fixture to verify replacement protection, restored content and safe composer defaults. The fixture is removed before commit. Real Google and email delivery are not exercised locally; the existing same-origin callback helper and query-preserving protected layout are unchanged.
