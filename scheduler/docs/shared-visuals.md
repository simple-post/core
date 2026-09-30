# Shared SimplePost visuals

The Next.js app and MCP iframe bundles use the same presentation components. API calls, authentication, routes, uploads, timezone conversion and persistent editor sessions belong to adapters outside `components/visual`.

| Surface                          | Shared implementation                                                               | Application adapter                                                                      | MCP adapter                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Theme, typography, controls      | `components/visual/theme.css`, `components/ui`                                      | `app/globals.css`                                                                        | `mcp-ui/extensions/design-system.css`                                |
| Brand and workspace navigation   | `visual/navigation.tsx`                                                             | `components/navbar.tsx`                                                                  | `extensions/workspace-app.tsx`                                       |
| Month/week/day calendar          | `visual/schedule-calendar.tsx`                                                      | `components/schedule-calendar.tsx`                                                       | `extensions/calendar.tsx`, also used by legacy `mcp-ui/schedule.tsx` |
| Accounts, connection empty state | `visual/account-card.tsx`                                                           | accounts page                                                                            | workspace adapter                                                    |
| Avatar and platform identity     | `visual/account-avatar.tsx`, `visual/platforms.ts`, `components/platform-icons.tsx` | avatar URL resolution in `components/account-avatar.tsx`                                 | server-provided image URLs                                           |
| Destination selection            | `components/account-row-picker.tsx`                                                 | `components/account-selector.tsx`                                                        | editor adapter                                                       |
| Post cards and status tabs       | `visual/post-card.tsx`, `visual/post-status-tabs.tsx`                               | posts list and dashboard                                                                 | workspace adapter                                                    |
| Message composer                 | `visual/message-composer.tsx`                                                       | `components/post-content-editor.tsx` provides upload/paste and character-budget handling | editor adapter provides working-copy changes                         |
| Live and scheduled previews      | `visual/preview-switcher.tsx` and the Preview library                               | `features/platform-preview` constructs platform data                                     | editor and legacy post-preview adapters construct platform data      |

Presentation props carry display data, callbacks, or React slots for host-specific actions. The calendar's `renderAction` callback receives semantic targets (`post`, `slot`, `settings`, `create`), not URLs. It is a render callback, not a component with its own hooks. Next.js supplies links; MCP supplies selection actions. A read-only caller can omit mutation actions.

The calendar adapter displays server-local wall-clock dates and labels, and preserves server `isPast` values. Those display dates are never used to schedule a post. The editor still receives the original slot instant and timezone.

Do not import Next.js, application hooks, deployment configuration, database clients or MCP services into visual components. Platform names/colors are browser-safe data; enabled-provider environment configuration remains in `lib/config`. The widget build rejects imports of application services and Next.js to catch accidental dependencies.

Both runtimes compile the existing Tailwind theme. Extension CSS covers host layout and extension-only interactions, and lives in the components layer so it cannot override shared utility styles. Preview CSS is standalone because legacy preview rendering does not require the whole workspace bundle.

## Compatibility and validation

Tool names, input/output schemas, resource entrypoint exports, OAuth and persistence contracts are unchanged. Existing application callbacks still own uploads, reconnect/disconnect, scheduling, deletion, and navigation. Manual editing remains hidden initially in the extension, and publishing still requires its explicit review action.

Run `yarn workspace @simple-post/scheduler check`, `build:mcp-widgets`, the scheduler tests and the e2e workspace's `extensions:smoke`. The smoke host uses fixture data, exercises both dedicated and workspace entrypoints, tests the legacy schedule and preview, and captures desktop/narrow screenshots without publishing anything. Also run the Next.js production build when changing shared components.

The iframe/host boundary follows the [MCP UI guidance](https://developers.openai.com/plugins/build/chatgpt-ui); component rendering stays independent of host transport.
