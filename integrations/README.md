# SimplePost Integrations

First-party integrations for automation platforms and agent ecosystems. Each one is versioned and released on its own so it can follow its host platform's packaging and marketplace rules.

| Integration  | Path                             | Purpose                                                           |
| ------------ | -------------------------------- | ----------------------------------------------------------------- |
| n8n          | [`n8n/`](n8n/)                   | Community node and trigger that use SimplePost Scheduler API keys |
| OpenClaw     | [`openclaw/`](openclaw/)         | ClawHub bundle of the canonical SimplePost skill                  |
| Hermes Agent | [`hermes-agent/`](hermes-agent/) | Hermes skill and MCP submission material                          |
| Meta Muse    | [`meta-muse/`](meta-muse/)       | Muse Code examples and connector submission material              |

Integrations call the documented Scheduler API or MCP server instead of duplicating platform-specific publishing logic.
