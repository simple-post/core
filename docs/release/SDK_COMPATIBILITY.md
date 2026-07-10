# SDK compatibility policy

This policy applies to the public `@simple-post/sdk` package beginning with
version 1.0.0.

## Versioning

The SDK follows [Semantic Versioning](https://semver.org/):

- **Patch** releases fix defects, security issues, provider compatibility, and
  documentation without intentionally breaking the public API.
- **Minor** releases add backward-compatible functions, options, platforms,
  result fields, subpath exports, or deprecations.
- **Major** releases may remove or rename public exports, change required input
  shapes, or make other intentionally incompatible changes.

Prerelease versions such as `2.0.0-beta.1` may change between prereleases. The
npm prerelease tag communicates that reduced stability.

## Supported runtime and module formats

- Node.js 20 or newer is the runtime baseline for SDK 1.x.
- ESM and CommonJS builds are published, together with TypeScript declarations.
- TypeScript 5.8 or newer is the declaration-compatibility baseline for SDK
  1.x. Newer maintained TypeScript releases should remain compatible.
- Only entry points declared in the package `exports` map are public. Imports
  into `@simple-post/sdk/dist/*` or other internal paths are unsupported.

The current public entry points are:

```text
@simple-post/sdk
@simple-post/sdk/validation
@simple-post/sdk/media-types
@simple-post/sdk/platform-names
```

## What is considered breaking

The following require a major SDK version unless needed to close an active
security issue:

- Removing or renaming a public export or platform key.
- Making an optional `Post`, credential, option, or result field required.
- Changing a public field to an incompatible TypeScript type.
- Changing documented error/result semantics in a way that requires consumer
  code changes.
- Dropping a supported Node.js major version before the next SDK major.

Adding optional fields, new platform-specific options, new typed error values,
or a new platform is normally backward-compatible.

## Provider-driven changes

Social platforms can change APIs, permissions, limits, and review requirements
without notice. SimplePost may adjust validation rules or provider requests in
a patch release when that is necessary to keep an existing integration
working. Such changes will be recorded in the changelog when they affect
observable behavior.

## Deprecations

Deprecated public APIs are marked in TypeScript declarations and documented in
the changelog. Where practical, a deprecated API remains available for at least
one minor release before removal in the next major release. Security fixes and
provider shutdowns may require a shorter transition; those exceptions receive
explicit migration notes.

## Related release documents

- [Changelog](../../CHANGELOG.md)
- [API versioning policy](API_VERSIONING.md)
- [Migration notes](MIGRATIONS.md)
