# Farcaster

SimplePost signs protocol-native CastAdd messages locally and submits them directly to Snapchain. The hosted Scheduler uses Farcaster's May 2026 gasless signer protocol; it does not use Neynar or ask users to paste signer keys.

## Scheduler connection

The operator configures a dedicated application FID, its server-only custody key, and one or more Snapchain endpoints:

```bash
FARCASTER_APP_FID=123456
FARCASTER_APP_CUSTODY_PRIVATE_KEY=0x... # 32-byte hex; secret manager only
FARCASTER_SNAPCHAIN_URLS=grpcs://primary.example:3383,grpcs://secondary.example:3383
# FARCASTER_SIGNER_TTL_SECONDS=2592000 # optional; 30-day sliding default
```

Users connect the Ethereum custody wallet for their FID and approve one `Farcaster KeyAdd` EIP-712 signature. SimplePost creates an encrypted signer limited to adding and removing casts. Disconnect revokes that signer on Snapchain before deleting it locally.

The May 2026 protocol does not support EIP-1271 custody authorization, so the custody wallet must currently be an EOA.

## Standalone SDK credentials

Advanced standalone use requires an already-authorized, scoped Ed25519 signer:

```bash
FARCASTER_FID=12345
FARCASTER_SIGNER_PRIVATE_KEY=0123... # 32-byte Ed25519 key; never use the FID custody key
FARCASTER_SNAPCHAIN_URLS=grpcs://primary.example:3383,grpcs://secondary.example:3383
FARCASTER_USERNAME=alice
```

The legacy `FARCASTER_HUB_URL` variable and `hubUrl` option remain compatibility aliases for a single endpoint.

```typescript
await post({
  content: { text: "Hello Farcaster", media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }] },
  platforms: ["farcaster"],
  options: {
    farcaster: {
      snapchainUrls: ["grpcs://primary.example:3383", "grpcs://secondary.example:3383"],
      username: "alice",
    },
  },
});
```

## Content

- Standard casts up to 320 UTF-8 bytes
- Long casts from 321 through 1,024 UTF-8 bytes
- Up to two public URL embeds for images or videos

Local media paths are not supported because casts embed public URLs rather than upload binary files.

## Protocol references

- [Finalized Snapchain Signers FIP](https://github.com/farcasterxyz/protocol/discussions/266)
- [Snapchain EIP-712 reference](https://github.com/farcasterxyz/snapchain/blob/main/cli/src/eip712.rs)
- [Snapchain key message builders](https://github.com/farcasterxyz/snapchain/blob/main/cli/src/factory.rs)
