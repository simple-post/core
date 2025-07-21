# Using Unsubpost through the TypeScript SDK

The simplest way to use Unsubpost is to integrate it directly into your TypeScript project as an NPM package. It exposes a simple, unified interface for all major social platforms.

## Installation

You can install the Unsubpost SDK using the npm package. Since this is a private package, you need to setup access to it first. The setup is slightly different depending on the package manager you are using.

### Create a GitHub Personal Access Token (PAT)

To create a Personal Access Token (PAT) for the Unsubpost NPM package, go to your [GitHub settings](https://github.com/settings/tokens) and create a new classic token.

1. Click "Generate new token" and choose classic.
2. Give the token a name, like for exmaple "Unsubpost NPM Access".
3. Set the expiration date to "No expiration". This is fine in this case as the repository doesn't contain any sensitive information.
4. Select the `read:packages` permission only.
5. Generate the token and save it - you will need it in the next step.

### Using `npm`, `yarn` or `pnpm`

If you are using `npm`, `yarn` or `pnpm` as a package manager, you can setup the access to the Unsubpost NPM package by adding the following to your `.npmrc` file:

```bash
@unsubpost:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

You can put your token in the `GITHUB_TOKEN` environment variable in your `.env` file or in your shell environment.

### Using `yarn 2`

For newer versions of `yarn` (version 2 and above), you can setup the access to the Unsubpost NPM package by adding the following to your `.yarnrc.yml` file:

```bash
npmScopes:
  unsubpost:
    npmRegistryServer: "https://npm.pkg.github.com"
    npmAuthToken: "${GITHUB_TOKEN}"
```

Again, you can put your token in the `GITHUB_TOKEN` environment variable in your `.env` file or in your shell environment.

### Install the package

You can install the package using your package manager of choice.

```bash
npm install @unsubpost/unsubpost

yarn add @unsubpost/unsubpost

pnpm add @unsubpost/unsubpost
```
