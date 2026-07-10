# API versioning policy

This policy applies to the public Scheduler HTTP API and the self-hosted HTTP
server beginning with the public v1 release.

## Version identifier

Public application endpoints use a major version in the path:

```text
/api/v1/...
```

The Scheduler and self-hosted server publish separate OpenAPI documents because
the self-hosted server implements a smaller, immediate-publishing subset. An
OpenAPI document's `info.version` describes the document revision; the `/v1/`
path remains the compatibility boundary for callers.

## Backward-compatible v1 changes

The following may ship without introducing `/api/v2`:

- Adding an endpoint or HTTP method.
- Adding an optional request field.
- Adding a response field while preserving existing fields and meanings.
- Adding an enum value where clients are already expected to handle unknown
  provider states.
- Adding a new authentication mechanism without removing an existing one.
- Tightening implementation behavior to enforce an already documented limit,
  close a security issue, or reject previously invalid input.

Clients should ignore unknown response fields and avoid exhaustive handling of
provider-originated strings unless the OpenAPI schema declares a closed enum.

## Breaking changes

A new major API path is required for planned changes such as:

- Removing or renaming a public endpoint or response field.
- Making a previously optional request field required.
- Changing a field to an incompatible type or changing its documented meaning.
- Replacing an authentication contract.
- Changing success or error status behavior in a way that requires callers to
  rewrite normal control flow.

If `/api/v2` is introduced, v1 and v2 may run in parallel. The changelog and
migration notes will identify the affected operations and the planned v1
retirement sequence before removal.

## Protocol and internal endpoints

- OAuth discovery, authorization, token, registration, and revocation endpoints
  follow their relevant OAuth and MCP protocol metadata instead of the
  application path version.
- MCP tool schemas are evolved additively where possible. An incompatible tool
  contract is introduced under a new tool name before the old one is removed.
- `/api/internal/*`, billing UI endpoints, framework authentication routes, and
  provider callback routes are operational interfaces rather than the public
  integration API. They may change with the matching deployment.

## Source of truth

The checked-in OpenAPI documents and the route implementation are released
together. Consumers should generate clients from the OpenAPI file matching the
deployed release, not from an unversioned documentation hostname.

- [Scheduler OpenAPI](https://github.com/simple-post/docs/blob/main/static/openapi/scheduler.json)
- [Self-hosted server OpenAPI](https://github.com/simple-post/docs/blob/main/static/openapi/server.json)

See also the [migration notes](MIGRATIONS.md) and
[changelog](../../CHANGELOG.md).
