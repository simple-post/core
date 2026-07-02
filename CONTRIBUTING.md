# Contributing to SimplePost

Thanks for your interest in contributing! This document covers the basics.

## Getting Started

Requirements: Node.js >= 20 and Yarn 4 (via Corepack).

```bash
git clone https://github.com/simple-post/core.git
cd core
corepack enable
yarn install
```

The repository is a Yarn workspaces monorepo:

| Workspace    | Package                  |
| ------------ | ------------------------ |
| `sdk/`       | `@simple-post/sdk`       |
| `server/`    | `@simple-post/server`    |
| `scheduler/` | `@simple-post/scheduler` |
| `cli/`       | `@simple-post/cli`       |
| `examples/`  | `@simple-post/examples`  |

## Development Workflow

Run checks (typecheck, lint, formatting) and tests before submitting:

```bash
yarn check        # all workspaces
yarn test         # SDK tests from the repo root
yarn workspace @simple-post/scheduler test
yarn workspace @simple-post/cli test
```

To auto-fix lint and formatting issues in a workspace:

```bash
yarn workspace @simple-post/sdk lint:fix
yarn workspace @simple-post/sdk format:fix
```

## Submitting Changes

1. Fork the repository and create a branch from `main`.
2. Make your changes, including tests for new behavior.
3. Make sure `yarn check` and the relevant test suites pass.
4. Open a pull request against `main` with a clear description of the change.

Commit messages follow the conventional style used in the history: `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...`.

## Bugs and Feature Requests

- Bugs: open a [GitHub issue](https://github.com/simple-post/core/issues) with steps to reproduce.
- Ideas and questions: start a thread in [Discussions](https://github.com/simple-post/core/discussions).
- Security issues: do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the license of the part of the repository they touch: [MIT](LICENSE) for everything except the Scheduler app, and the [O'Saasy License](scheduler/LICENSE) for code in `scheduler/`.
