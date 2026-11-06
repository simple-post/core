# Server interface language

The server catalog is separate from the frontend copy catalog. `serverMessage` marks authored error templates and retains canonical English in the exception for logs and internal decisions. API and MCP boundaries translate the marked template; interpolated user content and unmarked provider errors remain unchanged. API status codes, existing `code` values, tool names, input fields and enum values remain canonical. The additive `reason` field replaces prior English substring comparisons in posting recovery.

MCP locale precedence is explicit per-request metadata (`openai/locale`, then `locale`), browser preference cookie, saved user UI preference, Accept-Language, then English. Each server and callback has its own locale context. Standard Schema wrappers preserve validation/transforms and localize only descriptions and displayed validation messages. OpenAPI translation skips example/default/enum/const payloads.

The nullable `User.uiLocale` field stores the UI/email language separately from publishing preferences and post content. Apply `20261106010000_user_ui_locale` before deploying the branch; no production migration has been run. The authenticated `/api/ui-preference` endpoint accepts browser sessions only and writes only this field for that session's user. Signed-in workspace entry restores a saved preference when no browser preference exists. Disconnect emails choose the saved preference at first render and retain the existing immutable delivery payload/idempotency behavior on retry.

Run `yarn i18n:server:extract` after changing authored source and `yarn i18n:server:check` to verify all 15 catalogs and runtime registration. Only actual completed target catalogs belong in `server-catalogs.ts`. Missing targets deliberately fail the completeness gate.

OAuth's `error_description` and `WWW-Authenticate` retain their protocol values. Responses can additionally include a localized Unicode `message` for the consent screen. SDK validation attaches nonserialized descriptors. The response boundary translates those descriptors while preserving measured dimensions, codes, field paths, numeric values and raw provider details.

The complete scheduler UI overlay contains 1,189 authored entries and 36 plural families. The server targets are being prepared from frozen source batches. Local browser validation uses the active server message catalog only when displaying diagnostics. The UI completeness gate passes for all 15 locales. The server completeness gate requires all 14 target catalogs before registration.
