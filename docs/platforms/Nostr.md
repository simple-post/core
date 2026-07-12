# Nostr Platform-Specific Options

SimplePost publishes signed kind-1 text notes to Nostr relays. It supports private keys encoded as `nsec` or 64-character hex.

## Authentication

```bash
NOSTR_PRIVATE_KEY=nsec1...
NOSTR_RELAYS=wss://relay.damus.io,wss://nos.lol
```

The private key controls your Nostr identity and can sign events as you. Store it as a secret and use a dedicated key if that better fits your security model.

## Content Support

- Text notes
- Up to 10 public image or video URLs appended to the note
- Optional NIP-14 `subject` tag
- Publication to multiple relays; at least one relay must acknowledge the event

Nostr relays accept signed events, not binary uploads. Media therefore requires public HTTPS URLs; local file paths are rejected.

```typescript
await post({
  content: {
    text: "Hello Nostr",
    media: [{ type: "image", url: "https://cdn.example.com/image.jpg" }],
  },
  platforms: ["nostr"],
  options: {
    nostr: {
      relays: ["wss://relay.damus.io", "wss://nos.lol"],
      subject: "SimplePost",
    },
  },
});
```

The CLI connects with `simplepost account add nostr --private-key ... --relays ...`. The Scheduler app provides the same manual connection flow and encrypts the private key with other connected-account secrets.
