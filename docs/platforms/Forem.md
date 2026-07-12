# DEV/Forem Platform-Specific Options

SimplePost publishes Markdown articles to DEV Community or any Forem instance through API v1.

```bash
FOREM_INSTANCE_URL=https://dev.to
FOREM_API_KEY=
```

Supported options are `title`, `published` (defaults to `true`), up to four `tags`, `series`, `canonicalUrl`, `description`, and `organizationId`. Without a title, SimplePost uses the first Markdown heading or line. Public images become Markdown media and the first image is also used as the article's main image.

Create an API key in the Forem account settings. The CLI and Scheduler validate it with `/api/users/me` and store only the key as the account secret.
