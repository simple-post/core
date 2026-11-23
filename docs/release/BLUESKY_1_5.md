# Bluesky 1.5 release checks

This PR prepares SDK 1.5.0; it does not publish a package or deploy hosted services. Review/merge before following the existing tag-triggered release process.

- Verify the SDK checks, tests, ESM/CommonJS build and Node 20 imports. Provider calls are mocked; no public test post is authorized.
- Deploy hosted Scheduler/API/CLI consumers from the merged revision. They use the workspace SDK; an npm version bump by itself does not update the hosted application.
- Confirm root and thread-reply record payloads contain correct UTF-8 link/hashtag/mention facets, with unresolved mentions left as text. Verify existing OAuth/app-password behavior and explicit media/quote precedence.
- Check a card with metadata, a text-only card, failed metadata and failed thumbnail handling using intercepted provider calls or local fixtures. Metadata retrieval is limited to public HTTP(S), vetted/pinned DNS, revalidated redirects, bounded bytes and deadlines. Do not create public verification posts.
- Link cards are fetched at publishing time; current draft preview inputs do not contain this metadata. Do not render an invented title or thumbnail or advertise a guaranteed card before publication.
- After hosted behavior is verified, release the prepared marketing and docs feature-copy PRs. Regenerate docs product facts from this merged core revision. Refresh the published SDK snapshot/pin only after 1.5.0 is actually available in npm.
- Record actual package/hosted deployment dates and use those dates for GSC/Ahrefs follow-up and cohort comparisons.
