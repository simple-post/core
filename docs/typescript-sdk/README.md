# Using Unsubpost through the TypeScript SDK

The simplest way to use Unsubpost is to integrate it directly into your TypeScript project as an NPM package. It exposes a simple, unified interface for all major social platforms.

## Installation

You can install the Unsubpost SDK using the npm package. Since this is a private package, you need to setup access to it first. The setup is slightly different depending on the package manager you are using.

### Create a GitHub personal access token

You need to create a GitHub personal access token. You can do this by going to your [GitHub settings](https://github.com/settings/personal-access-tokens) and creating a new fine-grained token. Classic Personal Access Tokens are not recommended.

1. Click "Generate new token".
2. Give the token a name, like for exmaple "Unsubpost NPM Access".
3. Set the resource owner to the "UnsubPost" organization.
4. Set the expiration date to "No expiration". This is fine in this case as the repository doesn't contain any sensitive information.
5. Limit the access of the token to the `unsubpost` repository. This is not strictly necessary, but it's a good practice to limit the scope of the token.
6. Under "Permissions", "Repository permissions", select "Contents" and chosse the "Read-only" permission.
7. Note down the token. You will need it in the next step.

### Using `npm`

If you are using `npm` as a package manager, you can setup the access to the Unsubpost NPM package by running the following command:

```bash
npm config set //npm.pkg.github.com/:_authToken <your-token>
```

### Using `yarn`

If you are using `yarn` as a package manager, you can setup the access to the Unsubpost NPM package by running the following command:

```bash
yarn config set //npm.pkg.github.com/:_authToken <your-token>
```

### Using `pnpm`

If you are using `pnpm` as a package manager, you can setup the access to the Unsubpost NPM package by running the following command:

```bash
pnpm config set //npm.pkg.github.com/:_authToken <your-token>
```

### Install the package

```bash
npm install unsubpost
```
