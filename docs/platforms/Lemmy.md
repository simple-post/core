# Lemmy Platform-Specific Options

SimplePost publishes link or discussion posts to a community on a Lemmy instance. Stable Lemmy 0.19 uses API v3; API v4 can be selected for Lemmy 1.0 instances.

```bash
LEMMY_INSTANCE_URL=https://lemmy.example
LEMMY_JWT=
LEMMY_COMMUNITY_ID=123
LEMMY_API_VERSION=v3
```

Set `title`, `communityId`, `apiVersion`, `nsfw`, and `languageId` under `options.lemmy`. If no title is supplied, SimplePost uses the first line of the post body. The first public media URL becomes the link URL and additional media URLs are appended as Markdown. Local media paths are not supported.

The CLI and Scheduler can sign in with a username and password; only the returned JWT is stored as the connected-account secret.
