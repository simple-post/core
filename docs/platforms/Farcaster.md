# Farcaster Platform-Specific Options

SimplePost creates protocol-native CastAdd messages, signs them locally with an authorized Ed25519 signer, and submits them directly to a Farcaster Hub.

## Credentials

```bash
FARCASTER_FID=12345
FARCASTER_SIGNER_PRIVATE_KEY=0123... # 32-byte hex
FARCASTER_HUB_URL=hub.example.com:2283
FARCASTER_USERNAME=alice
```

The signer must already be authorized for the FID. Treat its private key as a secret. The Hub endpoint must expose secure gRPC submission.

## Content

- Standard casts up to 320 UTF-8 bytes
- Long casts from 321 through 1,024 UTF-8 bytes
- Up to two public URL embeds for images or videos

```typescript
await post({
  content: { text: "Hello Farcaster", media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }] },
  platforms: ["farcaster"],
  options: { farcaster: { hubUrl: "hub.example.com:2283", username: "alice" } },
});
```

Local media paths are not supported because casts embed URLs rather than upload binary files. CLI and Scheduler connections store the signer key with other account secrets.
