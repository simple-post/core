# LinkedIn Platform Specific Options

## Content Support

- **Text**: Up to 3000 characters
- **Media**: Images (JPG, PNG) or Videos (MP4)
- **Limit**: Up to 9 images or 1 video (no mixed media)
- **Requirements**: Must have text or media (no empty posts)

## Platform-Specific Options

### `visibility`

Control who can see the post:

- `PUBLIC` (default)
- `CONNECTIONS` (personal profiles only; company Pages require `PUBLIC`)

```typescript
await post({
  content: { text: "Posting to LinkedIn" },
  platforms: ["linkedin"],
  options: {
    linkedin: {
      visibility: "CONNECTIONS",
    },
  },
});
```

## Examples

### Basic Posts

```typescript
// Text only
const content = { text: "LinkedIn update!" };

// Image post
const content = {
  text: "New product screenshots",
  media: [{ type: "image", path: "./photo.jpg" }],
};

// Video post
const content = {
  text: "Demo video",
  media: [{ type: "video", path: "./video.mp4", title: "Demo", description: "Short demo video" }],
};
```

## Authentication

To post on LinkedIn you need:

```bash
LINKEDIN_ACCESS_TOKEN=
LINKEDIN_MEMBER_ID=
```

You can also pass credentials via `options.linkedin.credentials` if you are managing tokens yourself.


## Company Pages

The Scheduler can connect your personal profile and company Pages from the same LinkedIn login. Choose LinkedIn on **Accounts**, approve access, and select the destinations to connect. Each Page counts as one connected account. Reconnect existing LinkedIn accounts to grant the new Page permissions; existing personal-profile IDs and scheduled posts continue to work.

Only Pages for which LinkedIn confirms permission to create organic posts appear in the picker. If none appear, check the signed-in member's Page role (normally super admin or content admin) and the app's Community Management access. A failure to load Pages leaves the personal profile selectable and shows a warning.

The developer app needs Community Management API access with `w_organization_social` and `rw_organization_admin`, in addition to `openid profile email w_member_social`. The client ID, secret, and Scheduler callback URL remain the same. LinkedIn decides whether refresh tokens are issued; otherwise the user must reconnect when access expires. Existing tokens do not gain scopes automatically.

In the interactive CLI, run `simplepost account add linkedin` and choose a profile or Page. Run this command again with a separate alias to connect another destination. Non-interactive login continues to select the personal profile.

For direct SDK or HTTP-server use, pass a numeric `organizationId` instead of `memberId`:

```typescript
await post({
  content: { text: "An update from our company" },
  platforms: ["linkedin"],
  options: {
    linkedin: {
      visibility: "PUBLIC",
      credentials: {
        accessToken: "PAGE_ADMIN_MEMBER_ACCESS_TOKEN",
        organizationId: "12345678",
      },
    },
  },
});
```

Alternatively set `LINKEDIN_ACCESS_TOKEN` and `LINKEDIN_ORGANIZATION_ID`, leaving `LINKEDIN_MEMBER_ID` unset. Supply exactly one of `memberId` and `organizationId`; Page publishing uses the authorizing member's token, not a separate Page token.

Page posts use the versioned Posts, Images, and Videos APIs. Text, up to nine images, one video, quotes, and reposts are supported. Media is uploaded with the Page as owner, and publishing waits for processing. The existing 200 MB SimplePost video limit still applies. Page visibility must be public. Typed `@name` is plain text, not a LinkedIn entity mention.

See the [LinkedIn Page test checklist](../testing/linkedin-company-pages.md) before releasing changes to this integration.
