# SimplePost for Make

Source of the SimplePost custom app for [Make](https://www.make.com). The app is stored in the [Make Apps Editor](https://marketplace.visualstudio.com/items?itemName=Integromat.apps-sdk) local-development format: `src/makecomapp.json` lists every component and its code files, and the extension deploys them to Make.

## What the app does

| Group    | Module                 | Type            | API                                          |
| -------- | ---------------------- | --------------- | -------------------------------------------- |
| Triggers | Watch published posts  | Instant trigger | Webhook `post.published` (`/api/v1/webhooks`) |
| Triggers | Watch failed posts     | Instant trigger | Webhook `post.failed` (`/api/v1/webhooks`)    |
| Posts    | Search posts           | Search          | `GET /api/v1/posts?type=…` (paginated)        |
| Posts    | Get a post             | Action (read)   | `GET /api/v1/posts/{id}`                      |
| Posts    | Create a post          | Action (create) | `POST /api/v1/posts`                          |
| Posts    | Validate a post        | Action          | `POST /api/v1/validation`                     |
| Posts    | Delete a post          | Action (delete) | `DELETE /api/v1/posts/{id}`                   |
| Other    | Upload a media file    | Action (create) | `POST /api/v1/upload` (multipart)             |
| Other    | List accounts          | Search          | `GET /api/v1/accounts`                        |
| Other    | Make an API call       | Universal       | Any path relative to the SimplePost URL       |

The connection takes a Scheduler API key (`sp_api_…`, sent as `Authorization: Bearer`) and checks it against `GET /api/v1/accounts`. API keys require the `apiAccess` plan feature. The base URL defaults to `https://app.simplepost.social`; self-hosted Scheduler users can change it under the connection's advanced settings. The `listAccounts` RPC fills the **Accounts** selector in **Create a post** and **Validate a post**.

Requests run with a 300-second timeout (Make's maximum) because **Create a post** in **Publish now** mode waits for every platform to respond, and video uploads can take longer than Make's 40-second default.

## Layout

```
src/
  makecomapp.json                 # Project manifest used by the Make Apps Editor
  README.md                       # App documentation deployed to Make
  general/base.iml.json           # Base URL, auth header, error handling, sanitization, timeout
  connections/simplepost/         # API key connection
  webhooks/{published,failed}-posts/  # Dedicated webhooks with attach/detach
  rpcs/list-accounts/             # Accounts dropdown
  modules/<module>/               # communication, mappable params, interface, samples, scope
  modules/groups.json             # Module groups shown in the scenario editor
assets/make-icon.png              # 512×512 app icon in Make's logo format
```

## Checks

```bash
npm install      # once, installs the schema validator
npm test         # offline: manifest integrity, naming conventions, API contract
npm run validate # validates every file against the Make Apps Editor JSON schemas
```

`npm test` also runs in CI as `yarn make:check`. `npm run validate` downloads the schemas from a pinned commit of [integromat/vscode-apps-sdk](https://github.com/integromat/vscode-apps-sdk), the same schemas the extension uses in the editor.

## Deploy and publish

See [PUBLISHING.md](PUBLISHING.md).
