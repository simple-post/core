# Simple Post plugin language

The plugin supports English, Spanish, Brazilian Portuguese, French, German, Japanese, Italian, Korean, Simplified Chinese, Traditional Chinese, Arabic, Hindi, Indonesian, Turkish and Bulgarian.

## Preference and response contract

The authenticated account’s nullable `User.pluginLocale` stores a plugin-only preference. `null` means **Automatic**. It does not change the web/mobile app’s language settings or any content language.

Resolution order:

1. Optional tool argument `response_locale`, for an explicitly requested response/conversation language.
2. Saved plugin language.
3. Client `_meta["openai/locale"]`.
4. Legacy client `_meta["webplus/i18n"]`.
5. Existing request/host fallback, then English.

`get_language_settings` reads the preference. `set_plugin_language` saves a supported code or `auto`, only for the authenticated account and with the existing write permission. The widget control is at **Publishing workspace → Settings**. It saves immediately. Widgets preserve an explicit/saved override across host-locale updates, and resume client detection in Automatic mode.

Every ordinary tool result appends a text content block containing `{"resolvedLocale":"it"}`, for example. The original first content block and structured-content/output schemas remain compatible. Namespaced result metadata also carries the saved preference and optional response override for widgets. `response_locale` is removed before domain handlers receive their arguments.

Post messages, thread segments, account names and drafts stay unchanged. Scheduling timezones are independent.

## Automated and host checks

Automated tests exercise language precedence, legacy metadata, strict argument validation, concurrent locale isolation, preference persistence or account isolation, and preservation of user content. Widget locale tests check that host updates cannot overwrite a saved or explicit response language. These are deterministic server/bridge tests; they do not claim a real ChatGPT conversation was executed.

Before publishing the updated plugin package, check these conversations in the host against a deployed test endpoint:

| Conversation                                                                      | Expected behavior                                                                                                               |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Ask in Bulgarian, for example “Обясни това упражнение” for Simple Muscle          | Use `response_locale: "bg"` when Bulgarian is requested; explain localized results in Bulgarian. Preserve user names and notes. |
| “Switch to Italian” during an English conversation                                | Use `response_locale: "it"` for subsequent calls/answers until the user changes it. Do not save a preference automatically.     |
| “Save Italian as my plugin language”, then a new English client session           | Save `it`; widgets and tools remain Italian.                                                                                    |
| Select Automatic with an Arabic host locale                                       | Clear the preference; Arabic UI and RTL layout. Subsequent host-locale changes apply.                                           |
| A German conversation containing a Japanese title and Bulgarian notes/source text | Translate app-authored labels only; preserve the supplied content exactly.                                                      |
| Older client with only `webplus/i18n: "bg-BG"`                                    | Resolve to `bg` without changing schemas, identifiers or content.                                                               |
| A second connected account                                                        | Its preference stays independent; a read-only grant cannot change a preference.                                                 |

## Release

This change adds one nullable column through the repository’s normal Prisma migration process. Apply the additive migration before running the new server code. No existing content is rewritten. Keep existing feature/release gates, OAuth scopes, widget resource URIs and CSP policies.

The plugin manifest version is advanced for the skill changes. Deploy/test the compatible server update through the existing release process, then submit the new package version for plugin review. Repository tests and a source package do not establish host approval. This PR does not merge, deploy, publish or submit anything.
