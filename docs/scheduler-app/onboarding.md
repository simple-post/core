# First-post onboarding and preview import

Assistant-first signups still need a social publishing destination. The welcome dialog now recognizes a connected assistant and directs users to `/accounts?onboarding=connect`. MCP empty-account responses give the same direct route and tell the user to return to their conversation. After a successful account callback, users with an assistant get a copyable starter prompt; others get the assistant installation selector. Callback parameters are consumed only after onboarding state and local dismissal state are ready, preserving unrelated query parameters.

The dashboard distinguishes scheduling from successful publishing. Drafts, pending posts and failed posts do not complete the preparation milestone. A `published` post completes the publishing milestone. A partial failure remains incomplete until a post finishes successfully. No new database columns or migrations are needed, and this change does not retroactively emit conversion events.

## Preview import contract

Deploy this app change before the companion website preview CTA. The receiver is backward compatible with existing app links.

1. The website opens `/import#preview=<URI-encoded JSON>` in another tab. v1 accepts only known preview platform IDs, message strings, ordered follow-up strings and a media-presence flag. It does not accept account IDs, scheduling instructions, media URLs or identity fields. Limits are 11 variants, 10,000 characters per segment, 19 follow-ups per version and 48,000 JSON characters overall.
2. The public receiver strips the fragment, validates it, stores a temporary browser copy, and redirects to `/schedule?preview=<random UUID>`. Only that opaque identifier passes through Google/magic-link auth; post text is never in the auth callback or analytics URL.
3. On the composer, the user chooses one preserved platform version and explicitly imports it. A nonempty unsaved draft requires a replacement checkbox. Import resets accounts, overrides, schedule, media and repost settings, restores text and thread, and chooses draft mode. The user still selects accounts, uploads media and submits the form.
4. Browser copies expire after 24 hours. Dismissal removes the copy; opening another transfer cleans expired copies. Different browsers/devices cannot access it. Invalid links, expiry and unavailable storage show recovery guidance. Forem preview text can be imported, but hosted publishing availability is unchanged.

`Preview Draft Imported` fires on explicit import with a platform property, and `Activation Prompt Copied` fires on a successful clipboard write. No draft text is sent. Configure named goals in Plausible if needed; no live analytics settings are changed by this PR.

## Validation

Automated coverage validates the transfer boundary, Unicode and threads, rejected shapes and size limits, expiration, and milestone query semantics. Local browser review uses synthetic content: website preview → app sign-in with opaque ID, then the actual import component under a temporary provider fixture to verify replacement protection, restored content and safe composer defaults. The fixture is removed before commit. Real Google and email delivery are not exercised locally; the existing same-origin callback helper and query-preserving protected layout are unchanged.
