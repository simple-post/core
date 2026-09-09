# LinkedIn company Pages: release test checklist

Use a test LinkedIn company Page and a staging Scheduler with its own database. The branch does not change production data or deploy the feature. Live LinkedIn consent and publishing must be verified before release; automated tests mock the provider.

## Setup

- Enable LinkedIn in `NEXT_PUBLIC_ENABLED_SOCIAL_PROVIDERS` and configure the app's client ID, secret, and staging callback URL.
- Approve Community Management access and the scopes `openid profile email w_member_social w_organization_social rw_organization_admin` on that app.
- Have a member with publishing access to two Pages, plus a member with no eligible Pages. Include content-admin access, not only super-admin access.
- Keep an existing personal-profile connection and a scheduled personal post for regression testing.

## Connection and identity

- Connect LinkedIn. Check that the profile and all eligible Pages appear with distinct labels and correct names/logos. Nothing should be preselected.
- Connect just one Page, then a profile plus two Pages. Confirm account quotas count each destination and reject an over-quota selection atomically.
- Confirm personal IDs are unchanged. Page IDs must be `urn:li:organization:<id>` and reconnecting must update the existing destination rather than duplicate it.
- Confirm the pending-account GET response contains no access token, refresh token, or token metadata. Verify cross-user pending IDs, expired selections, and an injected unlisted Page ID are rejected.
- Try a user with no Pages, denied organic-post permission, and failed Page discovery. A useful warning should appear and the personal profile should remain selectable.
- If available, test enough memberships to paginate. A Page with multiple roles should appear only once.

## Publishing

- Publish text, a single image, multiple images, and a video larger than 4 MB. Confirm the Page is both the author and the owner of uploaded media; verify the full video, image order, and caption text on LinkedIn.
- Include parentheses, brackets, backslashes, emoji, `@name`, and hashtags in text. Verify the complete text is visible. Typed mentions are plain text.
- Schedule a Page post and a personal-profile post, then confirm each dispatches to its selected destination. Test a single SimplePost post targeting both destinations as well.
- Publish a quote and a repost as the Page. Verify both author identity and source attribution.
- Confirm Page posts use public visibility. An API request with `CONNECTIONS` must fail validation before posting; personal profiles still support it.
- Try a media processing failure and a rejected upload. Neither should create a text-only post or fall back to publishing on the admin's profile.

## Connection lifecycle

- Reconnect the Page and confirm its queued posts still use the same destination. Reconnecting with another authorized admin should replace the stored credential set.
- Verify access-token expiry is retained. If LinkedIn issued a refresh token, verify refresh preserves Page identity and refresh-token expiry metadata. If no refresh token was issued, verify reconnect guidance when access expires.
- Remove the member's Page publishing role after connecting. A publish attempt must fail with useful guidance and must not post as the member.
- Expire or remove the saved logo URL. The avatar route must refresh the Page logo, never substitute the author's personal photo.
- Test interactive CLI login selecting a Page and posting with that alias. Non-interactive login must retain its personal-profile behavior. Test direct SDK credentials with `organizationId` and environment credentials with `LINKEDIN_ORGANIZATION_ID`.

## Automated coverage

- `sdk/tests/LinkedInPagePublisher.test.ts`: text, images, multipart video ranges and ETags, processing failures/timeouts, authorship, visibility, credentials, punctuation, and provider failures.
- `sdk/tests/LinkedInPublisher.test.ts`: existing personal publishing and quote behavior.
- `scheduler/tests/lib/oauth/linkedin-pages.test.ts`: paginated discovery, deduplication, and organic-post permission checks.
- `scheduler/tests/lib/oauth/linkedin-callback.test.ts`: profile preservation, pending credentials, expiry, and warnings.
- `scheduler/tests/app/linkedin-pending-route.test.ts`: sanitized responses, destination authorization, expiry, credential persistence, and Facebook compatibility.
- Existing credential/avatar tests include Page-specific cases; CLI tests cover profile/Page selection and discovery failures.
- `e2e/tests/linkedin-picker.test.ts` mounts the actual React picker in Chromium with mocked network responses and covers explicit selection, quota-error recovery, and profile-only fallback.

## API references

- [Community Management access](https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review)
- [Organization ACLs](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role)
- [Organization authorizations](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-authorizations/organization-authorizations)
- [Posts](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api), [images](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api), and [videos](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/videos-api)
