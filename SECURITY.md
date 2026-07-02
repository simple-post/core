# Security Policy

SimplePost handles OAuth tokens and API credentials for social media accounts, so we take security reports seriously.

## Reporting a Vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Instead, report them privately via [GitHub Security Advisories](https://github.com/simple-post/core/security/advisories/new) ("Report a vulnerability" on the repository's Security tab).

Include as much of the following as you can:

- A description of the vulnerability and its impact.
- Steps to reproduce, ideally with a minimal example.
- The affected workspace (`sdk`, `server`, `scheduler`, `cli`) and version or commit.

You will get an acknowledgment as soon as possible, and updates as the report is triaged and fixed. Please give us a reasonable amount of time to release a fix before disclosing the issue publicly.

## Scope Notes

- Credentials are provided by you (environment variables, CLI account store, or the Scheduler app database). Leaked credentials caused by misconfigured deployments are outside the scope of this policy, but hardening suggestions are welcome.
- The Scheduler app is designed to be self-hosted. Keep your instance and its dependencies up to date.
