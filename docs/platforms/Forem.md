# DEV/Forem Platform-Specific Options

SimplePost publishes Markdown articles to DEV Community or any Forem instance through API v1.

```bash
FOREM_INSTANCE_URL=https://dev.to
FOREM_API_KEY=
```

Supported options are `title`, `published` (defaults to `true`), up to four `tags`, `series`, `canonicalUrl`, `description`, and `organizationId`. Without a title, SimplePost uses the first Markdown heading or line. Public images become Markdown media and the first image is also used as the article's main image.

For DEV Community, create a dedicated key under [Settings → Extensions](https://dev.to/settings/extensions) in the **DEV Community API Keys** section. For another Forem, use the equivalent API-key section in that instance's account settings. Give the key a recognizable name such as `SimplePost`, then paste it into SimplePost's connection dialog.

The CLI and Scheduler validate the key with `/api/users/me` and store it as the encrypted account secret. Treat it like a password: do not paste it into support messages or commit it to source control. Disconnecting the account from SimplePost deletes SimplePost's stored copy but does not revoke the key on Forem. To revoke access completely, return to the Forem API-key settings and revoke the key there; reconnect SimplePost with a newly generated key if needed.
