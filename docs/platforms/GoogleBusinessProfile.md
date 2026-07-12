# Google Business Profile Platform-Specific Options

SimplePost creates standard local posts for eligible Google Business Profile locations.

## Authentication

Create a Google Cloud OAuth client, request access to the Business Profile APIs, enable the Account Management and Business Information APIs, and authorize the `business.manage` scope. The CLI and Scheduler OAuth flows list eligible locations after consent.

For direct SDK or HTTP server use:

```bash
GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN=
GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN=
GOOGLE_BUSINESS_PROFILE_CLIENT_ID=
GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET=
GOOGLE_BUSINESS_PROFILE_LOCATION_NAME=accounts/123/locations/456
```

## Content and Options

- Summary text up to 1,500 characters
- Up to 10 public image or video URLs
- Optional language code
- Optional `BOOK`, `ORDER`, `SHOP`, `LEARN_MORE`, `SIGN_UP`, or `CALL` action

```typescript
await post({
  content: { text: "Summer hours are live", media: [{ type: "image", url: "https://cdn.example.com/hours.jpg" }] },
  platforms: ["google_business_profile"],
  options: {
    google_business_profile: {
      locationName: "accounts/123/locations/456",
      languageCode: "en-US",
      callToAction: { actionType: "LEARN_MORE", url: "https://example.com/hours" },
    },
  },
});
```

Google accepts media by public source URL; local paths are not supported. Each connected Scheduler or CLI account represents one business location.
