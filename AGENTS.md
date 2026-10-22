# Agent Instructions

## Production database access

For local production database work, use an operator-configured SSH tunnel and
the project's existing database credentials. Read private workspace-level
`AGENTS.md` instructions outside the repository, or the operator's local runbook,
for the connection details. If those instructions are unavailable, obtain them
from the operator rather than guessing an endpoint or using public database access.

- Keep production hostnames, addresses, port mappings, database names, usernames,
  SSH identity paths, and credentials out of tracked files, PR descriptions,
  comments, logs, and screenshots.
- Bind the local tunnel listener to loopback and use that endpoint in local
  clients. Keep deployed applications on their configured internal connections.
- Verify the database and role with `SELECT current_database(), current_user;`
  before working. Existing write-enabled credentials may be used for writes
  required by the user's task; keep changes within that scope and use
  transactions where practical.
- Do not run migrations, resets, or seed commands merely to test connectivity.
  Do not change firewall rules or public database exposure as part of connecting.
