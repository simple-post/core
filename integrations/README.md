# SimplePost Integrations

This directory contains first-party workflow-automation integrations. Each integration is an independently versioned and released package or platform definition so it can follow the conventions and marketplace requirements of its host platform.

| Integration | Path | Purpose |
| --- | --- | --- |
| n8n | [`n8n/`](n8n/) | Community node that uses SimplePost Scheduler API keys |

Every integration should use the documented Scheduler API rather than duplicate platform-specific publishing logic.
